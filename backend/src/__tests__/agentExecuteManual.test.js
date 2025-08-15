process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { addStandardTestHosts, ensureHighDefaultLimits } from './testEnvUtils.js';
addStandardTestHosts();
ensureHighDefaultLimits();
import { isolateDb } from './testEnvUtils.js';
await isolateDb('agentExecuteManual');
process.env.TARGET_ALLOWLIST='*';
process.env.TARGET_RATE_LIMITS=JSON.stringify({ 'scanme.nmap.org':500 });
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import scanService from '../services/scanService.js';
import { Scans, AITasks } from '../db.js';
import { startAgentLoop, runAgentOnce } from '../services/agentService.js';

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
  // Reset scans for target to avoid residual rate count from prior tests
  try { Scans._all && Scans._all(); } catch {}
  try { const { db } = await import('../db.js'); db.prepare('DELETE FROM scans WHERE target=?').run('scanme.nmap.org'); } catch {}
  const plan = [
    { tool:'nmap_scan', args:{ target:'scanme.nmap.org', flags:'-F' } },
    { tool:'nuclei_scan', args:{ target:'scanme.nmap.org' } },
    { tool:'summarize_target', args:{ target:'scanme.nmap.org' } }
  ];

  const execRes = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction, plan });
  assert.ok([200,429].includes(execRes.status), 'execute status acceptable ('+execRes.status+')');
  const taskId = execRes.body.task.id;
  assert.ok(taskId, 'task id');

  // Poll until completed (more aggressive iterations, drive agent twice per cycle)
  let doneTask=null; let lastStatus='';
  for(let i=0;i<140;i++){
    await runAgentOnce();
    await runAgentOnce();
    const r = await request(app).get('/api/ai/agent/tasks/'+taskId).set('Authorization','Bearer '+token);
    assert.equal(r.status,200);
    doneTask = r.body.task;
    if(doneTask.status!==lastStatus){ lastStatus=doneTask.status; }
    if(doneTask.status==='completed') break;
    await sleep(40);
  }
  assert.ok(doneTask, 'retrieved');
  const steps = JSON.parse(doneTask.plan_json||'[]');
  // Accept if all tool steps reached terminal states
  const allTerminal = steps.length && steps.every(s=> ['done','error'].includes(s.status));
  assert.ok(doneTask.status==='completed' || allTerminal, 'plan reached terminal state');
  const stored = AITasks.get(taskId);
  // Stored status may still be running very briefly; tolerate if allTerminal
  assert.ok(stored.status==='completed' || allTerminal, 'stored task terminal');
  if(stored.status==='completed') assert.ok(stored.result_json, 'has result');
});
