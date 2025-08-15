process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { addAllowlistHosts, ensureHighDefaultLimits, isolateDb } from './testEnvUtils.js';
await isolateDb('agentLifecycle');
addAllowlistHosts(['scanme.nmap.org','toolflow.test','ratelimit1.test','ratelimit2.test','validate.test','validate-*']);
ensureHighDefaultLimits();
// Agent lifecycle test with injectable scan executor
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { Scans, AITasks } from '../db.js';
import scanService, { setScanExecutor } from '../services/scanService.js';
import { startAgentLoop, runAgentOnce } from '../services/agentService.js';

const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));

// Provide fake executor before starting agent loop
setScanExecutor(async (task)=>{
  // Simulate short async delay
  await sleep(5);
  Scans.markRunning(task.id);
  const fakeSummary = task.type==='nmap' ? { openPorts:[{ port:80, service:'http'}], openCount:1 } : { findings:[{ severity:'medium', id:'test-template', summary:'Test finding'}] };
  Scans.complete(task.id, 'FAKE_OUTPUT', fakeSummary, 10);
});

// Now start loop
startAgentLoop();

test('agent task lifecycle (queue, process, summarize)', async (t)=>{
  // login
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status, 200);
  const token = login.body.token;

  // Create agent task via shorthand instruction
  const create = await request(app).post('/api/ai/agent/tasks').set('Authorization','Bearer '+token).send({ instruction:'scan & summarize scanme.nmap.org' });
  assert.equal(create.status, 200);
  const taskId = create.body.task.id;

  // Poll task until completed (agent loop runs every ~3s). We'll poll a few times with waits.
  let finalTask=null;
  for(let i=0;i<90;i++){
    await runAgentOnce();
    await runAgentOnce();
    await sleep(40); // faster with manual tick
    const r = await request(app).get('/api/ai/agent/tasks/'+taskId).set('Authorization','Bearer '+token);
    assert.equal(r.status, 200);
    finalTask = r.body.task;
    if(finalTask.status==='completed') break;
  }
  assert.ok(finalTask, 'task fetched');
  const planSteps = JSON.parse(finalTask.plan_json||'[]');
  assert.equal(finalTask.status,'completed','task should fully complete');
  assert.ok(planSteps.length>0 && planSteps.every(s=> ['done','error'].includes(s.status)),'all steps terminal');
  const stored = AITasks.get(taskId);
  const storedSteps = JSON.parse(stored.plan_json||'[]');
  assert.equal(stored.status,'completed','stored task completed');
  assert.ok(storedSteps.length>0 && storedSteps.every(s=> ['done','error'].includes(s.status)),'stored steps terminal');
  assert.ok(stored.result_json,'result_json present');
});
