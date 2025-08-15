process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { addAllowlistHosts, addStandardTestHosts, ensureHighDefaultLimits, isolateDb } from './testEnvUtils.js';
await isolateDb('timelineEndpoint');
ensureHighDefaultLimits();
const tlUnique = 'timeline-' + Date.now().toString(36) + '.test';
addStandardTestHosts([tlUnique]);
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import scanService from '../services/scanService.js';
import { Scans } from '../db.js';
import { startAgentLoop } from '../services/agentService.js';

const sleep = ms=> new Promise(r=> setTimeout(r, ms));
scanService.setExecutor(async (task)=>{ Scans.markRunning(task.id); await sleep(5); Scans.complete(task.id,'OUT', task.type==='nmap'? { openPorts:[] } : { findings:[] }, 0); });
startAgentLoop();

let token;

test('timeline: login admin & endpoint returns metrics', async ()=>{
  const rLogin = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(rLogin.status,200); token=rLogin.body.token;
  const plan = [ { tool:'nmap_scan', args:{ target:tlUnique } }, { tool:'summarize_target', args:{ target:tlUnique }, dependsOn:[0] } ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Timeline test', plan });
  assert.equal(exec.status,200,'execute 200'); const id = exec.body.task.id;
  let done=false; let lastStatuses='';
  for(let i=0;i<140;i++){
    await import('../services/agentService.js').then(m=> m.runAgentOnce());
    await import('../services/agentService.js').then(m=> m.runAgentOnce());
    await sleep(35);
    const t = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token);
    if(t.status!==200) continue;
    const planNow = JSON.parse(t.body.task.plan_json||'[]');
    const statusStr = planNow.map(s=> s.status).join(',');
    if(statusStr!==lastStatuses){ lastStatuses=statusStr; }
    if(t.body.task.status==='completed') { done=true; break; }
  }
  assert.ok(done,'task completed (statuses='+lastStatuses+')');
  const tl = await request(app).get('/api/ai/agent/tasks/'+id+'/timeline').set('Authorization','Bearer '+token);
  assert.equal(tl.status,200,'timeline 200');
  assert.ok(tl.body.timeline,'timeline object');
  assert.equal(tl.body.timeline.taskId, id,'taskId matches');
  assert.ok(Array.isArray(tl.body.timeline.steps),'steps array');
  assert.ok(tl.body.timeline.steps.length>=2,'>=2 steps');
  assert.ok('overallDurationMs' in tl.body.timeline,'has duration');
});
