process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
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

test('login admin', async ()=>{
  const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(r.status,200); token=r.body.token;
});

test('timeline endpoint returns metrics', async ()=>{
  const plan = [ { tool:'nmap_scan', args:{ target:'scanme.nmap.org' } }, { tool:'summarize_target', args:{ target:'scanme.nmap.org' }, dependsOn:[0] } ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Timeline test', plan });
  assert.equal(exec.status,200); const id = exec.body.task.id;
  let done=false; for(let i=0;i<30;i++){ await sleep(80); const t = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token); if(t.body.task.status==='completed'){ done=true; break; } }
  assert.ok(done,'task completed');
  const tl = await request(app).get('/api/ai/agent/tasks/'+id+'/timeline').set('Authorization','Bearer '+token);
  assert.equal(tl.status,200);
  assert.ok(tl.body.timeline);
  assert.equal(tl.body.timeline.taskId, id);
  assert.ok(Array.isArray(tl.body.timeline.steps));
  assert.ok(tl.body.timeline.steps.length>=2);
  assert.ok('overallDurationMs' in tl.body.timeline);
});
