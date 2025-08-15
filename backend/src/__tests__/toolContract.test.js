process.env.NODE_ENV='test';
import test from 'node:test';
import assert from 'node:assert';
import { isolateDb, addStandardTestHosts, ensureHighDefaultLimits } from './testEnvUtils.js';
await isolateDb('toolContract');
addStandardTestHosts(['contract.test']);
ensureHighDefaultLimits();
import { tools, toolManifest, executeToolStep } from '../aiTools.js';
import { enqueueScan } from '../services/scanService.js';

// Basic contract expectations for each registered tool

function findTool(id){ return toolManifest().find(t=> t.id===id); }

test('manifest exposes builtin tools with schema', () => {
  const m = toolManifest();
  const ids = m.map(t=> t.id).sort();
  ['nmap_scan','nuclei_scan','dns_lookup','summarize_target','validate_finding','report_findings'].forEach(id=>{
    assert.ok(ids.includes(id), 'manifest includes '+id);
    const entry = m.find(t=> t.id===id);
    assert.ok(entry.schema && typeof entry.schema === 'object', 'schema object for '+id);
  });
});

// Helper to execute a step while catching errors
async function runStep(step){
  try { return { ok:true, result: await executeToolStep(step, null, enqueueScan) }; }
  catch(e){ return { ok:false, error:e.message }; }
}

test('nmap_scan rejects invalid target', async () => {
  const r = await runStep({ tool:'nmap_scan', args:{ target:'@@@' } });
  assert.equal(r.ok, false);
});

test('dns_lookup resolves domain', async () => {
  const id = findTool('dns_lookup'); assert.ok(id);
  const r = await runStep({ tool:'dns_lookup', args:{ target:'scanme.nmap.org' } });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.result.addresses));
});

test('summarize_target returns structural keys even without scans', async () => {
  const r = await runStep({ tool:'summarize_target', args:{ target:'contract.test' } });
  assert.equal(r.ok,true);
  assert.ok('nmap' in r.result && 'nuclei' in r.result);
});

test('validate_finding negative result when no findings', async () => {
  const r = await runStep({ tool:'validate_finding', args:{ target:'contract.test', findingId:'abc123' } });
  assert.equal(r.ok,true);
  assert.equal(r.result.exists,false);
});

test('report_findings base shape', async () => {
  const r = await runStep({ tool:'report_findings', args:{ target:'contract.test' } });
  assert.equal(r.ok,true);
  assert.ok(Array.isArray(r.result.openPorts));
  assert.ok('findingCount' in r.result);
});
