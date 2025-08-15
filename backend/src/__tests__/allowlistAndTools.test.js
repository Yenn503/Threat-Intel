process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
process.env.TARGET_ALLOWLIST='scanme.nmap.org,*.example.com';
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { startAgentLoop } from '../services/agentService.js';
import scanService from '../services/scanService.js';
import { Scans } from '../db.js';

const sleep = ms=> new Promise(r=> setTimeout(r, ms));
scanService.setExecutor(async (task)=>{ Scans.markRunning(task.id); await sleep(5); Scans.complete(task.id,'FAKE', task.type==='nmap'? { openPorts:[] } : { findings:[] }, 0); });
startAgentLoop();

let token;

test('login admin', async ()=>{
  const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(r.status,200); token=r.body.token;
});

test('allowlist blocks disallowed target', async ()=>{
  const r = await request(app).post('/api/scan').set('Authorization','Bearer '+token).send({ target:'unauthorized.test', kind:'nmap' });
  assert.equal(r.status,403);
});

test('allowlist permits listed host', async ()=>{
  const r = await request(app).post('/api/scan').set('Authorization','Bearer '+token).send({ target:'scanme.nmap.org', kind:'nmap' });
  assert.equal(r.status,200);
});

test('validate/report placeholder tools execute via plan', async ()=>{
  const plan = [
    { tool:'nmap_scan', args:{ target:'scanme.nmap.org' } },
    { tool:'report_findings', args:{ target:'scanme.nmap.org' }, dependsOn:[0] },
    { tool:'validate_finding', args:{ target:'scanme.nmap.org', findingId:'fake-1' }, dependsOn:[1] }
  ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Full workflow', plan });
  assert.equal(exec.status,200);
  const id = exec.body.task.id; let done=false; for(let i=0;i<60;i++){ await sleep(80); const r= await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token); if(r.body.task.status==='completed'){ done=true; break; } }
  assert.ok(done,'workflow completed');
});
