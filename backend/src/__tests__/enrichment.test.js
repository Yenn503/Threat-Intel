process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { isolateTestDb, seedAdmin, Scans, ScanEnrichment } from '../db.js';
import bcrypt from 'bcryptjs';
import test from 'node:test';
import assert from 'node:assert';
import { enqueueScan, setScanExecutor } from '../services/scanService.js';
import { enrichScanSummary } from '../services/agentRuntimeService.js';
import '../tools/builtinTools.js';

// Deterministic fake summaries
function fakeNmap(){
  return { openPorts:[ { port:22, service:'ssh' }, { port:80, service:'http' }, { port:3306, service:'mysql' } ], openCount:3, serviceTags:['ssh','http','mysql'] };
}
function fakeNuclei(){
  return { findings:[ { id:'CVE-1', severity:'high', summary:'http issue' }, { id:'CVE-2', severity:'medium', summary:'mysql config' } ] };
}

// Install executor that applies enrichment + persistence path (mimic executeScan core behavior)
function installEnrichmentExecutor(){
  setScanExecutor(async (task)=>{
    Scans.markRunning(task.id);
    let summary = task.type==='nmap'? fakeNmap() : fakeNuclei();
    try { summary = enrichScanSummary({ id:task.id, type:task.type, target:task.target, command:task.command }, summary); } catch {}
    // Simulate score derivation (not critical to assertions)
    Scans.complete(task.id, 'RAW', summary, 10);
    // executeScan would upsert enrichment; replicating simplified via direct DAO (ScanEnrichment.upsert called inside executeScan, but our stub bypasses it)
    try { const { ScanEnrichment } = await import('../db.js'); ScanEnrichment.upsert(task.id, summary); } catch {}
  });
}

await (async ()=>{ isolateTestDb('enrichment'); seedAdmin(bcrypt); installEnrichmentExecutor(); })();

const sleep = ms=> new Promise(r=> setTimeout(r, ms));

test('enrichment pipeline persists & contains expected recon/vuln fields', async ()=>{
  const target='enrich.test';
  const nmapId='nmap-enrich-1';
  Scans.create({ id:nmapId, user_id:null, target, type:'nmap', command:'nmap '+target });
  enqueueScan({ id:nmapId, type:'nmap', command:'nmap '+target, target });
  await sleep(30);
  const nucleiId='nuclei-enrich-1';
  Scans.create({ id:nucleiId, user_id:null, target, type:'nuclei', command:'nuclei -u '+target });
  enqueueScan({ id:nucleiId, type:'nuclei', command:'nuclei -u '+target, target });
  await sleep(30);
  const nmapRow = ScanEnrichment.get(nmapId); const nucleiRow = ScanEnrichment.get(nucleiId);
  assert.ok(nmapRow, 'nmap enrichment row exists');
  assert.ok(nucleiRow, 'nuclei enrichment row exists');
  let nmapData={}, nucleiData={};
  try { nmapData = JSON.parse(nmapRow.data); } catch {}
  try { nucleiData = JSON.parse(nucleiRow.data); } catch {}
  // Recon expectations
  assert.ok(nmapData.recon, 'recon enrichment present');
  assert.ok(Array.isArray(nmapData.recon.categories) && nmapData.recon.categories.includes('web') && nmapData.recon.categories.includes('remote_access'), 'expected recon categories');
  assert.ok(Array.isArray(nmapData.recon.riskHints) && nmapData.recon.riskHints.length>0, 'risk hints populated');
  // Vuln expectations
  assert.ok(nucleiData.vuln, 'vuln enrichment present');
  assert.equal(nucleiData.vuln.severityCounts.high, 1, 'high severity count');
  assert.equal(nucleiData.vuln.severityCounts.medium, 1, 'medium severity count');
});

