process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { isolateDb } from './testEnvUtils.js';
await isolateDb('multiAgentScaffold');
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import { startAgentLoop } from '../services/agentService.js';

startAgentLoop();

test('multi-agent scaffold adds agent tags', async ()=>{
  const login = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(login.status,200);
  const token = login.body.token;
  const plan = [
    { tool:'nmap_scan', args:{ target:'scanme.nmap.org', flags:'-F' } },
    { tool:'summarize_target', args:{ target:'scanme.nmap.org' } }
  ];
  const r = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Test multi-agent', plan });
  assert.equal(r.status,200);
  const storedPlan = JSON.parse(r.body.task.plan_json||'[]');
  assert.ok(storedPlan.every(s=> s.agent),'all steps tagged with agent');
});
