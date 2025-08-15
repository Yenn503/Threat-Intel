process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';

let token;

await test('login', async ()=>{
  const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(r.status,200); token=r.body.token;
});

await test('error middleware masks internal error', async ()=>{
  const r = await request(app).get('/api/ai/_test/error').set('Authorization','Bearer '+token);
  assert.equal(r.status,500);
  assert.equal(r.body.error,'Internal error');
});
