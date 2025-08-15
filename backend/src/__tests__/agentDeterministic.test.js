process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { isolateDb, addStandardTestHosts, ensureHighDefaultLimits } from './testEnvUtils.js';
await isolateDb('agentDeterministic');
addStandardTestHosts();
ensureHighDefaultLimits();

import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { runAgentOnce } from '../services/agentService.js';

const sleep = ms=> new Promise(r=> setTimeout(r, ms));

// This test verifies deterministic agent progression: each explicit runAgentOnce invocation
// advances at most one logical step transition (pending->running/waiting/done or waiting->done)
// across the task's plan. We measure macro-level step advancement count.

test('deterministic agent advances <=1 step per tick', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200);
  const token = login.body.token;
  const plan = [
    { tool:'nmap_scan', args:{ target:'scanme.nmap.org', flags:'-F' } },
    { tool:'summarize_target', args:{ target:'scanme.nmap.org' } }
  ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'deterministic test', plan });
  assert.equal(exec.status,200);
  const id = exec.body.task.id;

  let lastNonPending = 0;
  let iterations = 0;
  let completed = false;
  while(iterations < 20){
    await runAgentOnce();
    // Brief pause so scan executor can complete if triggered this tick
    await sleep(15);
    const r = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token);
    assert.equal(r.status,200);
    const t = r.body.task; const steps = JSON.parse(t.plan_json||'[]');
    assert.equal(steps.length, plan.length, 'plan length stable');
    const nonPending = steps.filter(s=> s.status!=='pending').length;
    // Non-pending count should never jump by >1 between ticks in deterministic mode
    assert.ok(nonPending - lastNonPending <= 1, `nonPending advanced by >1 (prev=${lastNonPending} now=${nonPending}) steps=${steps.map(s=>s.status).join(',')}`);
    lastNonPending = nonPending;
    if(t.status==='completed') { completed=true; break; }
    iterations++;
  }
  assert.ok(completed, 'task completed within iteration budget');
});
