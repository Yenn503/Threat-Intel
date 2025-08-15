process.env.NODE_ENV = 'test';
process.env.ENABLE_LLM_TESTS = '0';
globalThis.__TESTING__ = true;
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';

let token;

test('ai routes minimal', async (t) => {
  await t.test('login admin', async () => {
    const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
    assert.equal(r.status, 200);
    token = r.body.token;
  });

  await t.test('GET /api/ai/tools', async () => {
    const r = await request(app).get('/api/ai/tools').set('Authorization','Bearer '+token);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.tools));
  });

  await t.test('POST /api/ai/chat with LLM disabled fallback', async () => {
    const r = await request(app).post('/api/ai/chat').set('Authorization','Bearer '+token).send({ message:'Hello assistant' });
    assert.equal(r.status, 200);
    assert.ok(r.body.reply);
  });

  await t.test('POST /api/ai/agent/plan fallback when LLM disabled', async () => {
    const r = await request(app).post('/api/ai/agent/plan').set('Authorization','Bearer '+token).send({ instruction:'Scan scanme.nmap.org quickly' });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.plan));
    assert.ok(r.body.plan.length > 0);
  });
});
