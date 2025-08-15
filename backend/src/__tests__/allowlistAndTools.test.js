process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { addAllowlistHosts, addStandardTestHosts, ensureHighDefaultLimits, mergeTargetRateLimits, isolateDb } from './testEnvUtils.js';
await isolateDb('allowlistAndTools');
addStandardTestHosts(['validate-*','*.example.com']);
ensureHighDefaultLimits();
process.env.TARGET_RATE_LIMITS=JSON.stringify({ 'scanme.nmap.org':50, 'toolflow.test':10 });
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

async function ensureLogin(){
  if(token) return token;
  const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(r.status,200); token=r.body.token; return token;
}

test('login admin', async ()=>{ await ensureLogin(); });

test('allowlist blocks disallowed target', async ()=>{
  await ensureLogin();
  const r = await request(app).post('/api/scan').set('Authorization','Bearer '+token).send({ target:'unauthorized.test', kind:'nmap' });
  assert.equal(r.status,403);
});

test('allowlist permits listed host', async ()=>{
  await ensureLogin();
  // Reset prior scans for shared target to avoid cross-test rate limit interference
  const { db } = await import('../db.js');
  db.prepare('DELETE FROM scans WHERE target=?').run('scanme.nmap.org');
  const r = await request(app).post('/api/scan').set('Authorization','Bearer '+token).send({ target:'scanme.nmap.org', kind:'nmap' });
  assert.equal(r.status,200,'expected 200 got '+r.status+' body='+(r.body? JSON.stringify(r.body):''));
});

test('validate/report placeholder tools execute via plan', async ()=>{
  await ensureLogin();
  const plan = [
    { tool:'nmap_scan', args:{ target:'toolflow.test' } },
    { tool:'report_findings', args:{ target:'toolflow.test' }, dependsOn:[0] },
    { tool:'validate_finding', args:{ target:'toolflow.test', findingId:'fake-1' }, dependsOn:[1] }
  ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Full workflow', plan });
  assert.ok(exec && typeof exec.status==='number', 'execute response present');
  assert.equal(exec.status,200, 'execute returned 200');
  const id = exec.body.task.id; let done=false; for(let i=0;i<120;i++){ await sleep(80); const r= await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token); if(r.body.task.status==='completed'){ done=true; break; } }
  assert.ok(done,'workflow completed');
});
