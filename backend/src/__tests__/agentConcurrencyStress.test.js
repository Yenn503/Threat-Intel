process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { isolateDb, addStandardTestHosts, ensureHighDefaultLimits, addAllowlistHosts } from './testEnvUtils.js';
await isolateDb('agentConcurrencyStress');
addStandardTestHosts();
ensureHighDefaultLimits();
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { runAgentOnce } from '../services/agentService.js';

const sleep = ms=> new Promise(r=> setTimeout(r, ms));

test('per-agent concurrency respected under stress', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200);
  const token = login.body.token;
  const target = 'scanme.nmap.org'; // already in standard test hosts allowlist
  addAllowlistHosts([target]);
  const plan = [];
  for(let i=0;i<5;i++) plan.push({ tool:'nmap_scan', args:{ target, flags:'-F' } });
  plan.push({ tool:'report_findings', args:{ target }, dependsOn: plan.map((_,i)=> i ) });
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'stress concurrency test', plan });
  assert.equal(exec.status,200);
  const id = exec.body.task.id;
  let completed=false; let maxReconRunning=0; let iterations=0;
  while(iterations<100){
    await runAgentOnce();
    await sleep(20);
    const r = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token);
    if(r.status!==200){ iterations++; continue; }
    const steps = JSON.parse(r.body.task.plan_json||'[]');
    const reconRunning = steps.filter(s=> s.agent==='recon' && ['running','waiting'].includes(s.status)).length;
    if(reconRunning > maxReconRunning) maxReconRunning = reconRunning;
    assert.ok(reconRunning <= 3, 'recon concurrency cap breached');
    if(r.body.task.status==='completed'){ completed=true; break; }
    iterations++;
  }
  assert.ok(completed,'task completed within iteration budget');
  assert.ok(maxReconRunning<=3,'max recon running observed within cap');
});
