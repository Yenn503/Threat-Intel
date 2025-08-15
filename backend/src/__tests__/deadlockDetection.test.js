process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
// Set a very small deadlock timeout so the circular dependency triggers failure quickly
process.env.AGENT_DEADLOCK_MS='300';
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { startAgentLoop } from '../services/agentService.js';

startAgentLoop();

// With configurable deadlock timeout, verify circular dependency triggers task failure quickly.

test('circular dependency rejected at plan ingestion', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200); const token = login.body.token;
  const plan = [
    { tool:'report_findings', args:{ target:'scanme.nmap.org' }, dependsOn:[1] },
    { tool:'validate_finding', args:{ target:'scanme.nmap.org', findingId:'x' }, dependsOn:[0] }
  ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Cycle test', plan });
  assert.equal(exec.status,400);
  assert.match(exec.body.error||'',/cyclic|cycle/i);
});
