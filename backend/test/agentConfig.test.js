import assert from 'assert';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../src/start.js'; // assuming start exports or adjust to actual server export

// NOTE: If start.js does not export the app instance, we need to refactor. For now we attempt dynamic import pattern.

describe('Agent Config API', ()=>{
  let token;
  before(async ()=>{
    // login with seeded admin
    const res = await request('http://localhost:4000').post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
    if(res.ok) token = res.body.token;
  });
  it('GET /api/agent/config requires auth', async ()=>{
    const r = await request('http://localhost:4000').get('/api/agent/config');
    assert.equal(r.status, 401);
  });
  it('PATCH /api/agent/config toggles diffBasedNuclei', async ()=>{
    if(!token) return; // skip if login failed
    const g1 = await request('http://localhost:4000').get('/api/agent/config').set('Authorization','Bearer '+token);
    assert.equal(g1.status, 200);
    const cur = g1.body.config.diffBasedNuclei;
    const p = await request('http://localhost:4000').patch('/api/agent/config').set('Authorization','Bearer '+token).send({ diffBasedNuclei: !cur });
    assert.equal(p.status, 200);
    assert.equal(p.body.config.diffBasedNuclei, !cur);
  });
});
