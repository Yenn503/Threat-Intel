process.env.NODE_ENV='test';
import { isolateDb, addStandardTestHosts, mergeTargetRateLimits, ensureHighDefaultLimits } from './testEnvUtils.js';
await isolateDb('perTargetRateLimitParallel');
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
process.env.TARGET_RATE_WINDOW_MS='60000';
// Provide only specific hosts
const uniqueSuffix = Date.now().toString(36);
const baseTarget = 'parallel-rate-' + uniqueSuffix + '.test';
addStandardTestHosts([baseTarget]);
mergeTargetRateLimits({ [baseTarget]: 5 }); // allow 5 in window
ensureHighDefaultLimits();
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import scanService from '../services/scanService.js';
import { Scans, db } from '../db.js';
import { startAgentLoop, runAgentOnce } from '../services/agentService.js';

const sleep = ms=> new Promise(r=> setTimeout(r, ms));
scanService.setExecutor(async (task)=>{ Scans.markRunning(task.id); await sleep(5); Scans.complete(task.id,'OUT',{ openPorts:[] },0); });
startAgentLoop();

let token;
async function login(){
  if(token) return token;
  const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(r.status,200,'login ok'); token=r.body.token; return token;
}

test('parallel direct scan submits enforce per-target limit fairly', async ()=>{
  await login();
  db.prepare('DELETE FROM scans WHERE target=?').run(baseTarget);
  const attempts = 10; // attempt 10 submissions concurrently with limit=5
  const headers = { Authorization:'Bearer '+token };
  const posts = Array.from({ length: attempts }).map(()=> request(app).post('/api/scan').set(headers).send({ target: baseTarget, kind:'nmap' }));
  const res = await Promise.all(posts);
  const okCount = res.filter(r=> r.status===200).length;
  const limitedCount = res.filter(r=> r.status===429).length;
  assert.equal(okCount, 5, 'exactly limit accepted (got '+okCount+')');
  assert.equal(limitedCount, attempts-5, 'remaining rejected (got '+limitedCount+')');
});

test('parallel agent plan steps respect limit with mixed outcomes', async ()=>{
  await login();
  db.prepare('DELETE FROM scans WHERE target=?').run(baseTarget);
  const plan = Array.from({ length: 8 }).map(()=> ({ tool:'nmap_scan', args:{ target: baseTarget } }));
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'parallel rate plan', plan });
  assert.equal(exec.status,200,'plan execute 200');
  const id = exec.body.task.id;
  let observedErrors=0; let observedDone=0; let attempts=0;
  for(; attempts<250; attempts++){
    await runAgentOnce();
    const t = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token);
    if(t.status!==200) continue;
    const steps = JSON.parse(t.body.task.plan_json||'[]');
    observedErrors = steps.filter(s=> s.status==='error').length;
    observedDone = steps.filter(s=> s.status==='done').length;
    const unsettled = steps.some(s=> ['pending','running','waiting'].includes(s.status));
    if(!unsettled) break;
  }
  assert.ok(observedDone <= 5, 'no more than limit scans completed (done='+observedDone+')');
  assert.ok(observedErrors >= 1, 'at least one rate limit error observed');
});
