process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { startAgentLoop } from '../services/agentService.js';

startAgentLoop();

// Shorten DEADLOCK_MS via env override not implemented; instead craft circular deps and poll for fail.
// We won't actually wait 5 minutes in tests: instead we verify that circular dep keeps task pending (sanity)
// Without a configurable timeout, we just ensure it does NOT complete quickly (acts as regression guard).

test('circular dependency does not falsely complete (sanity)', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200); const token = login.body.token;
  const plan = [
    { tool:'report_findings', args:{ target:'scanme.nmap.org' }, dependsOn:[1] },
    { tool:'validate_finding', args:{ target:'scanme.nmap.org', findingId:'x' }, dependsOn:[0] }
  ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Cycle test', plan });
  assert.equal(exec.status,200); const id = exec.body.task.id;
  let completed=false; for(let i=0;i<10;i++){ await new Promise(r=> setTimeout(r,120)); const r = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token); if(r.body.task.status==='completed'){ completed=true; break; } }
  assert.equal(completed,false,'should not complete quickly due to cycle');
});
