import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { db, Scans, ScanRecs, AIMessages } from '../db.js';
import { MAX_SCAN_MS, MAX_OUTPUT_BYTES } from '../constants.js';

// Parsing helpers (migrated from server.js)
export function parseNmap(output){
  const lines = output.split(/\r?\n/);
  const openPorts = [];
  for(const l of lines){
    const m = l.match(/^(\d+)\/tcp\s+open\s+([a-z0-9_-]+)/i); if(m) openPorts.push({ port:parseInt(m[1],10), service:m[2] });
  }
  const tagMap = { tomcat:'tomcat', apache:'apache', nginx:'nginx', http:'http', ssh:'ssh', rdp:'rdp', ftp:'ftp', mysql:'mysql', mariadb:'mysql', mssql:'mssql', postgres:'postgres', redis:'redis' };
  const tags = new Set();
  for(const p of openPorts){ const svc=(p.service||'').toLowerCase(); for(const k of Object.keys(tagMap)){ if(svc.includes(k)) tags.add(tagMap[k]); } }
  return { openPorts, openCount: openPorts.length, serviceTags: Array.from(tags) };
}
export function parseNuclei(output){
  const findings = [];
  const simple = /\[(low|medium|high|critical)\]\s*\[([^\]]+)\]\s*([^\n]+)/ig;
  let m; while((m=simple.exec(output))){ findings.push({ severity:m[1].toLowerCase(), id:m[2], summary:m[3].trim() }); }
  return { findings, counts: findings.reduce((a,f)=>{ a[f.severity]=(a[f.severity]||0)+1; return a; },{}) };
}
export function deriveScore(summary){
  if(!summary) return 0;
  let score = 0;
  if(summary.openCount) score += Math.min(summary.openCount*1.5, 40);
  if(summary.findings){
    for(const f of summary.findings){
      if(f.severity==='critical') score += 25; else if(f.severity==='high') score += 15; else if(f.severity==='medium') score += 6; else score += 2;
    }
  }
  return Math.min(100, score);
}

// Queue & execution state with injectable executor
const scanQueue = [];
let scanning = false;
let customExecutor = null; // if set via setScanExecutor
export function setScanExecutor(fn){ customExecutor = typeof fn === 'function' ? fn : null; }
export function enqueueScan(task){ scanQueue.push(task); process.nextTick(runNext); }
function runNext(){
  if(scanning) return;
  const next = scanQueue.shift();
  if(!next) return;
  scanning = true;
  const execFn = customExecutor || executeScan;
  Promise.resolve(execFn(next)).catch(()=>{/* swallow to avoid breaking queue */}).finally(()=>{
    scanning = false;
    if(scanQueue.length) runNext();
  });
}
export function queueDepth(){ return scanQueue.length; }

async function executeScan(task){
  const { id, type, command } = task;
  Scans.markRunning(id);
  return new Promise(resolve=>{
    const [bin, ...args] = command.split(/\s+/);
    const proc = spawn(bin, args, { stdio:['ignore','pipe','pipe'] });
    let out=''; let err=''; let killed=false;
    const timeout = setTimeout(()=>{ try { killed=true; proc.kill('SIGKILL'); } catch{} }, MAX_SCAN_MS);
    proc.stdout.on('data', d=> { out += d.toString(); if(out.length > MAX_OUTPUT_BYTES+10000) out = out.slice(0,MAX_OUTPUT_BYTES)+'\n[truncated]'; });
    proc.stderr.on('data', d=> { err += d.toString(); if(err.length > 200000) err = err.slice(0,200000)+'\n[truncated]'; });
    proc.on('error', e=> { clearTimeout(timeout); Scans.fail(id, 'spawn error '+e.message); resolve(); });
    proc.on('close', code=>{
      clearTimeout(timeout);
      if(killed){ Scans.fail(id, 'timeout exceeded'); return resolve(); }
      const raw = out + (err? ('\n[stderr]\n'+err):'');
      let summary={};
      try { if(type==='nmap') summary = parseNmap(raw); else if(type==='nuclei') summary = parseNuclei(raw); } catch{}
      const score = deriveScore(summary);
      Scans.complete(id, raw.slice(0,500000), summary, score);
      generateRecommendations(type, summary, id);
      autoTargetedNuclei(type, summary, task, id).finally(()=> resolve());
    });
  });
}

async function autoTargetedNuclei(type, summary, task, parentId){
  if(type!=='nmap' || !summary?.openPorts?.length) return;
  const svcMap = { 'tomcat':'tomcat','apache':'apache','nginx':'nginx','ssh':'ssh','rdp':'rdp','ftp':'ftp','mysql':'mysql','mariadb':'mysql','mssql':'mssql','postgres':'postgres','redis':'redis','http':'http' };
  const tags = new Set();
  for(const p of summary.openPorts){ const svc=(p.service||'').toLowerCase(); for(const k of Object.keys(svcMap)){ if(svc.includes(k)) tags.add(svcMap[k]); } }
  if(!tags.size) return;
  const tagList = Array.from(tags).sort().join(',');
  try {
    const recent = db.prepare('SELECT command FROM scans WHERE target=? AND type="nuclei" AND created_at>?').all(task.target, Date.now()-12*3600*1000);
    const already = recent.some(r=> r.command.includes('-tags') && tagList.split(',').every(t=> r.command.includes(t)));
    if(already) return;
    const baseBin = process.env.NUCLEI_PATH||'nuclei';
    const command = `${baseBin} -u ${task.target} -tags ${tagList} -severity medium,high,critical`;
    const nid = uuidv4();
    const scanOwner = Scans.get(parentId)?.user_id || null;
    Scans.create({ id:nid, user_id:scanOwner, target:task.target, type:'nuclei', command });
    enqueueScan({ id:nid, type:'nuclei', command, target:task.target });
    if(scanOwner){ AIMessages.add(scanOwner,'assistant', `Auto-queued nuclei scan (${tagList}) for ${task.target} based on nmap services.`); }
  } catch{}
}

// Recommendation generation utilities
export function generateRecommendations(type, summary, scanId){
  if(type==='nmap' && summary.openPorts){
    for(const p of summary.openPorts.slice(0,50)){
      ScanRecs.add(scanId, `Review necessity of port ${p.port}/${p.service}. If unnecessary restrict via firewall.`, 10 - Math.min(p.port/10000,9));
    }
  }
  if(type==='nuclei' && summary.findings){
    for(const f of summary.findings.slice(0,50)){
      ScanRecs.add(scanId, `Assess ${f.id} (${f.severity}) and apply vendor patch / mitigation.`, f.severity==='critical'?50:f.severity==='high'?30:f.severity==='medium'?15:5);
    }
  }
}

export default {
  enqueueScan,
  queueDepth,
  setExecutor: setScanExecutor,
  setScanExecutor
};
