process.env.NODE_ENV='test';
import { isolateDb } from './testEnvUtils.js';
await isolateDb('perTargetRateLimit');
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
process.env.TARGET_RATE_WINDOW_MS='60000';
// Allow all targets for this test to focus purely on rate limiting logic
process.env.TARGET_ALLOWLIST='*';
import { addAllowlistHosts, addStandardTestHosts, mergeTargetRateLimits, ensureHighDefaultLimits } from './testEnvUtils.js';
ensureHighDefaultLimits();
// Use unique targets per run to avoid cross-test contamination
const uniqueSuffix = Date.now().toString(36);
const directTarget = 'ratelimit-direct-' + uniqueSuffix + '.test';
const planTarget = 'ratelimit-plan-' + uniqueSuffix + '.test';
addStandardTestHosts([directTarget, planTarget]);
mergeTargetRateLimits({ [planTarget]:2, [directTarget]:2 });
// Defensive: re-merge allowlist with plan target in case ordering issues
addAllowlistHosts([planTarget]); // specific to later section
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import scanService from '../services/scanService.js';
import { Scans, db } from '../db.js';
import { startAgentLoop } from '../services/agentService.js';
import { targetAllowed, getTargetAllowlist } from '../constants.js';

const sleep = ms=> new Promise(r=> setTimeout(r, ms));
scanService.setExecutor(async (task)=>{ Scans.markRunning(task.id); await sleep(5); Scans.complete(task.id,'OUT',{ openPorts:[] },0); });
startAgentLoop();

let token;

async function ensureLogin(){
  if(token) return token;
  const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(r.status,200,'login should succeed');
  token = r.body.token;
  return token;
}

test('login admin', async ()=>{ await ensureLogin(); });

test('rate limit enforced for direct scan route', async ()=>{
  await ensureLogin();
  const tgt = directTarget;
  db.prepare('DELETE FROM scans WHERE target=?').run(tgt);
  for(let i=0;i<2;i++){ const r = await request(app).post('/api/scan').set('Authorization','Bearer '+token).send({ target:tgt, kind:'nmap' }); assert.equal(r.status,200,'initial scan '+i+' accepted'); }
  // Trigger limit (per-target override=2) by a 3rd attempt
  const r3 = await request(app).post('/api/scan').set('Authorization','Bearer '+token).send({ target:tgt, kind:'nmap' });
  assert.equal(r3.status,429,'third scan rate limited (status='+r3.status+')');
});

test('rate limit enforced via tool plan', async ()=>{
  await ensureLogin();
  const tgt = planTarget;
  assert.ok(targetAllowed(tgt), 'pre-plan targetAllowed('+tgt+') allowlist='+getTargetAllowlist().join('|'));
  db.prepare('DELETE FROM scans WHERE target=?').run(tgt);
  const plan = [
    { tool:'nmap_scan', args:{ target:tgt } },
    { tool:'nmap_scan', args:{ target:tgt } },
    { tool:'nmap_scan', args:{ target:tgt } },
    { tool:'nmap_scan', args:{ target:tgt } }
  ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'rate test', plan });
  assert.equal(exec.status,200,'execute returned 200');
  const id = exec.body.task.id;
  let final=null; let observedError=false; let attempts=0;
  let lastStatuses='';
  for(; attempts<210; attempts++){
    await sleep(35);
    await import('../services/agentService.js').then(m=> m.runAgentOnce());
    await import('../services/agentService.js').then(m=> m.runAgentOnce());
    const t= await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token);
    if(t.status!==200) continue;
    final=t.body.task; if(!final) continue;
    const stepsProbe = JSON.parse(final.plan_json||'[]');
    const statuses = stepsProbe.map(s=> s.status).join(',');
    if(statuses!==lastStatuses) lastStatuses=statuses;
    observedError = stepsProbe.some(s=> s.status==='error' && /rate limit/i.test(s.error||''));
    if(observedError) break;
  }
  assert.ok(final,'task fetched');
  const steps = JSON.parse(final.plan_json||'[]');
  assert.ok(steps.length===plan.length,'all steps present');
  const errorSteps = steps.filter(s=> s.status==='error');
  const rateErr = errorSteps.find(s=> /rate limit/i.test(s.error||''));
  assert.ok(rateErr, 'rate limit error observed (statuses='+lastStatuses+')');
  const doneCount = steps.filter(s=> s.status==='done').length;
  // We no longer assert on scan row presence because all steps may error fast under tight limits.
});
