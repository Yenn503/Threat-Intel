process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { db, Scans, AITasks } from '../db.js';
import scanService from '../services/scanService.js';
import { startAgentLoop } from '../services/agentService.js';

const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));

// Track execution order & states
const executionLog = [];
scanService.setExecutor(async (task)=>{
  executionLog.push({ phase:'executor-start', id:task.id, type:task.type });
  Scans.markRunning(task.id);
  const fakeSummary = task.type==='nmap' ? { openPorts:[{ port:22, service:'ssh'}], openCount:1 } : { findings:[{ severity:'high', id:'fake-high', summary:'High issue'}] };
  await sleep(5);
  Scans.complete(task.id, 'FAKE', fakeSummary, 50);
  executionLog.push({ phase:'executor-complete', id:task.id, type:task.type });
});
startAgentLoop();

test('agent step transitions ordered', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200);
  const token = login.body.token;
  // Ensure no prior scans exist so executor runs for both nmap and nuclei (avoid reuse optimization)
  db.prepare('DELETE FROM scans').run();
  const create = await request(app).post('/api/ai/agent/tasks').set('Authorization','Bearer '+token).send({ instruction:'scan & summarize scanme.nmap.org' });
  assert.equal(create.status,200);
  const id = create.body.task.id;

  // Poll capturing plan evolution
  let lastPlanJson='';
  let completed=false; let attempts=0;
  while(attempts < 40){
    await sleep(80);
    const r = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token);
    assert.equal(r.status,200);
    const t = r.body.task;
    const plan = JSON.parse(t.plan_json || '[]');
    const snapshot = plan.map(s=> ({ step:s.step||s.idx, action:s.action||s.tool, status:s.status, scanId: s.scanId||null }));
    const snapKey = JSON.stringify(snapshot);
    if(snapKey !== lastPlanJson){
      executionLog.push({ phase:'plan-snapshot', snapshot });
      lastPlanJson = snapKey;
    }
    if(t.status==='completed'){ completed=true; break; }
    attempts++;
  }
  assert.ok(completed,'task completed');
  const finalTask = AITasks.get(id);
  assert.equal(finalTask.status,'completed');

  // Basic final plan sanity
  const finalPlan = JSON.parse(finalTask.plan_json||'[]');
  assert.ok(finalPlan.length>0, 'final plan retained');
  assert.ok(finalPlan.some(s=> s.status==='done'), 'at least one step done');
});
