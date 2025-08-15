process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { isolateDb, addAllowlistHosts, ensureHighDefaultLimits } from './testEnvUtils.js';
await isolateDb('agentDeterministicMulti');
addAllowlistHosts(['scanme.nmap.org']);
ensureHighDefaultLimits();

import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { runAgentOnce } from '../services/agentService.js';

const sleep = ms=> new Promise(r=> setTimeout(r, ms));

// Multi-step deterministic progression: nmap -> nuclei -> summarize_target
// Ensure exactly ordered incremental advancement and final completion within bound.

test('deterministic multi-step progression nmap -> nuclei -> summarize', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200);
  const token = login.body.token;
  const plan = [
    { tool:'nmap_scan', args:{ target:'scanme.nmap.org', flags:'-F' } },
    { tool:'nuclei_scan', args:{ target:'scanme.nmap.org' }, dependsOn:[0] },
    { tool:'summarize_target', args:{ target:'scanme.nmap.org' }, dependsOn:[1] }
  ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'multi deterministic test', plan });
  assert.equal(exec.status,200);
  const id = exec.body.task.id;
  let lastStatuses = [];
  let iterations=0; let completed=false;
  while(iterations < 50){
    await runAgentOnce();
    await sleep(18);
    const r = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token);
    assert.equal(r.status,200);
    const steps = JSON.parse(r.body.task.plan_json||'[]');
    const statuses = steps.map(s=> s.status);
    // Ensure no status reversion
    if(lastStatuses.length){
      for(let i=0;i<statuses.length;i++){
        const prev = lastStatuses[i]; const cur = statuses[i];
        const order = ['pending','running','waiting','done','error'];
        if(prev && prev!==cur){
          assert.ok(order.indexOf(cur) >= order.indexOf(prev), `step ${i} regressed ${prev}->${cur}`);
        }
      }
      // Ensure at most one step newly leaves 'pending' per iteration (deterministic cap)
      const deltaAdv = statuses.filter((s,i)=> s!=='pending' && lastStatuses[i]==='pending').length;
      assert.ok(deltaAdv <= 1, 'more than one step advanced simultaneously');
    }
    lastStatuses = statuses;
    if(r.body.task.status==='completed'){ completed=true; break; }
    iterations++;
  }
  assert.ok(completed,'completed within deterministic iteration budget');
});
