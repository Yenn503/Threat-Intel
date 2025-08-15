process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { addStandardTestHosts, ensureHighDefaultLimits, isolateDb } from './testEnvUtils.js';
await isolateDb('orchestratorDependencies');
addStandardTestHosts();
ensureHighDefaultLimits();
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { startAgentLoop, runAgentOnce } from '../services/agentService.js';
import scanService from '../services/scanService.js';
import { Scans } from '../db.js';

const sleep = ms=> new Promise(r=> setTimeout(r, ms));

scanService.setExecutor(async (task)=>{
  Scans.markRunning(task.id);
  // Longer delay so polling loop can capture dependency state before completion
  await sleep(180);
  const fakeSummary = task.type==='nmap'? { openPorts:[{ port:8080, service:'http'}], openCount:1 } : { findings:[] };
  Scans.complete(task.id,'FAKE', fakeSummary, 5);
});

startAgentLoop();

test('dependency-gated steps only run after deps complete', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200);
  const token = login.body.token;
  const plan = [
    { tool:'nmap_scan', args:{ target:'scanme.nmap.org' }, agent:'recon' },
    { tool:'summarize_target', args:{ target:'scanme.nmap.org' }, agent:'report', dependsOn:[0] }
  ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Dep test', plan });
  assert.equal(exec.status,200);
  const id = exec.body.task.id;
  let done=false; let orderingValid=true; let attempts=0; let lastStatuses='';
  while(attempts<110){
    await runAgentOnce();
    await runAgentOnce();
    await sleep(55);
    const r = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token);
    assert.equal(r.status,200);
    const task = r.body.task;
    const steps = JSON.parse(task.plan_json||'[]');
    const statuses = steps.map(s=> s.status).join(',');
    if(statuses!==lastStatuses) lastStatuses=statuses;
    if(steps[1] && ['running','waiting','done'].includes(steps[1].status)){
      if(!(steps[0] && steps[0].status==='done')) orderingValid=false;
    }
    if(task.status==='completed'){ done=true; break; }
    attempts++;
  }
  assert.ok(done,'task reached completed state');
  assert.ok(orderingValid,'second step never advanced before first completed');
});

test('agents manifest endpoint', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200); const token=login.body.token;
  const r = await request(app).get('/api/ai/agents').set('Authorization','Bearer '+token);
  assert.equal(r.status,200);
  assert.ok(Array.isArray(r.body.agents));
  assert.ok(r.body.agents.some(a=> a.id==='recon'));
});
