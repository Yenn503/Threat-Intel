import { v4 as uuidv4 } from 'uuid';
import dns from 'dns/promises';
import { registerTool } from './toolRegistry.js';
import { db, Scans } from '../db.js';
import { TARGET_REGEX, targetAllowed, getTargetRateWindowMs, getTargetRateMaxForTarget } from '../constants.js';

export function buildScan(kind, target, flags=''){
  const baseBin = kind==='nmap'? (process.env.NMAP_PATH||'nmap') : (process.env.NUCLEI_PATH||'nuclei');
  const safeFlags = String(flags||'').replace(/[^A-Za-z0-9_:\-\s\/.]/g,'');
  return kind==='nmap'? `${baseBin} -Pn -sV ${safeFlags} ${target}` : `${baseBin} -u ${target} ${safeFlags}`;
}
function enqueueingScanRun(kind, defaultFlags){
  return ({ args, userId, enqueueScan }) => {
    const { target, flags='' } = args;
    if(!TARGET_REGEX.test(target)) throw new Error('invalid target');
    if(!targetAllowed(target)) throw new Error('target not allowed');
    const recent = db.prepare('SELECT COUNT(*) as c FROM scans WHERE target=? AND created_at>=?').get(target, Date.now()-getTargetRateWindowMs()).c;
    if(recent >= getTargetRateMaxForTarget(target)) throw new Error('rate limit: target scan quota exceeded');
    const command = buildScan(kind, target, flags || defaultFlags);
    const id = uuidv4();
    Scans.create({ id, user_id:userId, target, type:kind, command });
    enqueueScan && enqueueScan({ id, type:kind, command, target });
    return { scanId:id, kind };
  };
}
registerTool({ id:'nmap_scan', kind:'scanner', version:'1.0.0', requiresBinary:true, description:'Run an nmap service/version scan (fast by default).', inputSchema:{ required:['target'], properties:{ target:{ type:'string' }, flags:{ type:'string' } } }, run: enqueueingScanRun('nmap','-F') });
registerTool({ id:'nuclei_scan', kind:'scanner', version:'1.0.0', requiresBinary:true, description:'Run nuclei scan (restricted severities).', inputSchema:{ required:['target'], properties:{ target:{ type:'string' }, flags:{ type:'string' } } }, run: enqueueingScanRun('nuclei','-severity medium,high,critical') });
registerTool({ id:'dns_lookup', kind:'utility', version:'1.0.0', description:'Resolve A/AAAA records for domain.', inputSchema:{ required:['target'], properties:{ target:{ type:'string' } } }, async run({ args }){ const look = await dns.lookup(args.target,{ all:true }); return { addresses: look.map(r=>r.address) }; } });
registerTool({ id:'summarize_target', kind:'reporter', version:'1.0.0', description:'Summarize most recent scans for a target.', inputSchema:{ required:['target'], properties:{ target:{ type:'string' } } }, run({ args }){ const { target } = args; const lastNmap = db.prepare("SELECT summary_json FROM scans WHERE target=? AND type='nmap' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(target); const lastNuclei = db.prepare("SELECT summary_json FROM scans WHERE target=? AND type='nuclei' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(target); let nmapSummary={}, nucleiSummary={}; try { nmapSummary = JSON.parse(lastNmap?.summary_json||'{}'); } catch{} try { nucleiSummary = JSON.parse(lastNuclei?.summary_json||'{}'); } catch{} return { nmap: nmapSummary, nuclei: nucleiSummary }; } });
registerTool({ id:'validate_finding', kind:'enricher', version:'1.0.0', description:'Validate a finding id against current scan outputs (placeholder).', inputSchema:{ required:['findingId','target'], properties:{ findingId:{type:'string'}, target:{type:'string'} } }, run({ args }){ const { findingId, target } = args; if(!targetAllowed(target)) throw new Error('target not allowed'); const lastNuclei = db.prepare("SELECT summary_json FROM scans WHERE target=? AND type='nuclei' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(target); let nucleiSummary={ findings:[] }; try { nucleiSummary = JSON.parse(lastNuclei?.summary_json||'{}'); } catch {} const hit = (nucleiSummary.findings||[]).find(f=> f.id===findingId || f.templateID===findingId || f.name===findingId); if(hit){ return { findingId, exists:true, validated:true, severity: hit.severity||null, evidence: hit.evidence||'found in latest scan' }; } return { findingId, exists:false, validated:false, reason:'finding not present in latest nuclei results' }; } });
registerTool({ id:'report_findings', kind:'reporter', version:'1.0.0', description:'Aggregate latest summaries into a report (placeholder).', inputSchema:{ required:['target'], properties:{ target:{type:'string'} } }, run({ args }){ const { target } = args; if(!targetAllowed(target)) throw new Error('target not allowed'); const lastNmap = db.prepare("SELECT summary_json FROM scans WHERE target=? AND type='nmap' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(target); const lastNuclei = db.prepare("SELECT summary_json FROM scans WHERE target=? AND type='nuclei' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(target); let nmapSummary={}, nucleiSummary={ findings:[] }; try { nmapSummary = JSON.parse(lastNmap?.summary_json||'{}'); } catch{} try { nucleiSummary = JSON.parse(lastNuclei?.summary_json||'{}'); } catch{} const findings = nucleiSummary.findings||[]; const severityCounts = findings.reduce((acc,f)=>{ const s=(f.severity||'unknown').toLowerCase(); acc[s]=(acc[s]||0)+1; return acc; },{}); return { target, openPorts: nmapSummary.openPorts||[], openPortCount: (nmapSummary.openPorts||[]).length||0, findings, findingCount: findings.length, severityCounts, generatedAt: new Date().toISOString() }; } });
export function ensureBuiltinToolsLoaded(){}
