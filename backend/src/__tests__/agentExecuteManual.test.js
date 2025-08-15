process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import scanService from '../services/scanService.js';
import { Scans, AITasks } from '../db.js';
import { startAgentLoop } from '../services/agentService.js';

const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));

// Inject fake executor
scanService.setExecutor(async (task)=>{
  Scans.markRunning(task.id);
  const fakeSummary = task.type==='nmap' ? { openPorts:[{ port:443, service:'https'}], openCount:1 } : { findings:[{ severity:'medium', id:'exec-medium', summary:'Medium issue'}] };
  await sleep(5);
  Scans.complete(task.id, 'FAKE_OUTPUT', fakeSummary, 20);
});
startAgentLoop();

test('manual agent execute endpoint runs plan to completion', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200);
  const token = login.body.token;

  const instruction = 'Manual plan for scanme.nmap.org';
  const plan = [
    { tool:'nmap_scan', args:{ target:'scanme.nmap.org', flags:'-F' } },
    { tool:'nuclei_scan', args:{ target:'scanme.nmap.org' } },
    { tool:'summarize_target', args:{ target:'scanme.nmap.org' } }
  ];

  const execRes = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction, plan });
  assert.equal(execRes.status,200);
  const taskId = execRes.body.task.id;
  assert.ok(taskId, 'task id');

  // Poll until completed
  let doneTask=null;
  for(let i=0;i<40;i++){
    await sleep(120);
    const r = await request(app).get('/api/ai/agent/tasks/'+taskId).set('Authorization','Bearer '+token);
    assert.equal(r.status,200);
    doneTask = r.body.task;
    if(doneTask.status==='completed') break;
  }
  assert.ok(doneTask, 'retrieved');
  assert.equal(doneTask.status,'completed');

  const stored = AITasks.get(taskId);
  assert.equal(stored.status,'completed');
  assert.ok(stored.result_json, 'has result');
});
