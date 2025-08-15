// Lightweight AI tool registry & executor
import { v4 as uuidv4 } from 'uuid';
import { db, Scans } from './db.js';
import dns from 'dns/promises';
import { TARGET_REGEX, targetAllowed } from './constants.js';

export function buildScan(kind, target, flags=''){
  const baseBin = kind==='nmap'? (process.env.NMAP_PATH||'nmap') : (process.env.NUCLEI_PATH||'nuclei');
  const safeFlags = String(flags||'').replace(/[^A-Za-z0-9_:\-\s\/\.]/g,'');
  return kind==='nmap'? `${baseBin} -Pn -sV ${safeFlags} ${target}` : `${baseBin} -u ${target} ${safeFlags}`;
}

export const tools = {
  nmap_scan: {
    description: 'Run an nmap service/version scan (fast by default).',
    schema: { required:['target'], properties:{ target:{type:'string'}, flags:{type:'string'} } },
    run: ({ target, flags='' }, userId, enqueueScan) => {
  if(!TARGET_REGEX.test(target)) throw new Error('invalid target');
  if(!targetAllowed(target)) throw new Error('target not allowed');
      const command = buildScan('nmap', target, flags||'-F');
      const id = uuidv4();
      Scans.create({ id, user_id:userId, target, type:'nmap', command });
      enqueueScan({ id, type:'nmap', command, target });
      return { scanId:id, kind:'nmap' };
    }
  },
  nuclei_scan: {
    description: 'Run nuclei scan (restricted severities).',
    schema: { required:['target'], properties:{ target:{type:'string'}, flags:{type:'string'} } },
    run: ({ target, flags='' }, userId, enqueueScan) => {
  if(!TARGET_REGEX.test(target)) throw new Error('invalid target');
  if(!targetAllowed(target)) throw new Error('target not allowed');
      const command = buildScan('nuclei', target, flags||'-severity medium,high,critical');
      const id = uuidv4();
      Scans.create({ id, user_id:userId, target, type:'nuclei', command });
      enqueueScan({ id, type:'nuclei', command, target });
      return { scanId:id, kind:'nuclei' };
    }
  },
  dns_lookup: {
    description: 'Resolve A/AAAA records for domain.',
    schema: { required:['target'], properties:{ target:{type:'string'} } },
    run: async ({ target }) => {
      const look = await dns.lookup(target, { all:true });
      return { addresses: look.map(r=>r.address) };
    }
  },
  summarize_target: {
    description: 'Summarize most recent scans for a target.',
    schema: { required:['target'], properties:{ target:{type:'string'} } },
    run: ({ target }) => {
      const lastNmap = db.prepare('SELECT summary_json FROM scans WHERE target=? AND type="nmap" AND status="completed" ORDER BY created_at DESC LIMIT 1').get(target);
      const lastNuclei = db.prepare('SELECT summary_json FROM scans WHERE target=? AND type="nuclei" AND status="completed" ORDER BY created_at DESC LIMIT 1').get(target);
      let nmapSummary={}, nucleiSummary={};
      try { nmapSummary = JSON.parse(lastNmap?.summary_json||'{}'); } catch{}
      try { nucleiSummary = JSON.parse(lastNuclei?.summary_json||'{}'); } catch{}
      return { nmap: nmapSummary, nuclei: nucleiSummary };
    }
  }
  , validate_finding: {
    description: 'Validate a finding id against current scan outputs (placeholder).',
    schema: { required:['findingId','target'], properties:{ findingId:{type:'string'}, target:{type:'string'} } },
    run: ({ findingId, target }) => {
      if(!targetAllowed(target)) throw new Error('target not allowed');
      const lastNuclei = db.prepare('SELECT summary_json FROM scans WHERE target=? AND type="nuclei" AND status="completed" ORDER BY created_at DESC LIMIT 1').get(target);
      let nucleiSummary={ findings:[] };
      try { nucleiSummary = JSON.parse(lastNuclei?.summary_json||'{}'); } catch {}
      const hit = (nucleiSummary.findings||[]).find(f=> f.id===findingId || f.templateID===findingId || f.name===findingId);
      if(hit){
        return { findingId, exists:true, validated:true, severity: hit.severity||null, evidence: hit.evidence||'found in latest scan' };
      }
      return { findingId, exists:false, validated:false, reason:'finding not present in latest nuclei results' };
    }
  }
  , report_findings: {
    description: 'Aggregate latest summaries into a report (placeholder).',
    schema: { required:['target'], properties:{ target:{type:'string'} } },
    run: ({ target }) => {
      if(!targetAllowed(target)) throw new Error('target not allowed');
      const lastNmap = db.prepare('SELECT summary_json FROM scans WHERE target=? AND type="nmap" AND status="completed" ORDER BY created_at DESC LIMIT 1').get(target);
      const lastNuclei = db.prepare('SELECT summary_json FROM scans WHERE target=? AND type="nuclei" AND status="completed" ORDER BY created_at DESC LIMIT 1').get(target);
      let nmapSummary={}, nucleiSummary={ findings:[] };
      try { nmapSummary = JSON.parse(lastNmap?.summary_json||'{}'); } catch{}
      try { nucleiSummary = JSON.parse(lastNuclei?.summary_json||'{}'); } catch{}
      const findings = nucleiSummary.findings||[];
      const severityCounts = findings.reduce((acc,f)=>{ const s=(f.severity||'unknown').toLowerCase(); acc[s]=(acc[s]||0)+1; return acc; },{});
      return { target, openPorts: nmapSummary.openPorts||[], openPortCount: (nmapSummary.openPorts||[]).length||0, findings, findingCount: findings.length, severityCounts, generatedAt: new Date().toISOString() };
    }
  }
};

export function toolManifest(){
  return Object.entries(tools).map(([id, t])=> ({ id, description: t.description, schema: t.schema }));
}

function validateArgs(schema, args){
  args = args||{};
  if(schema?.required){
    for(const r of schema.required){ if(args[r]===undefined) throw new Error(`missing required arg: ${r}`); }
  }
  if(schema?.properties){
    for(const [k,v] of Object.entries(schema.properties)){
      if(args[k]!==undefined && v.type && typeof args[k] !== v.type) throw new Error(`arg ${k} type mismatch`);
    }
  }
  return args;
}

export async function executeToolStep(step, userId, enqueueScan){
  const t = tools[step.tool]; if(!t) throw new Error('unknown tool');
  const args = validateArgs(t.schema, step.args);
  return await t.run(args, userId, enqueueScan);
}
