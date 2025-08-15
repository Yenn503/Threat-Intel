process.env.NODE_ENV = 'test';
globalThis.__TESTING__ = true;
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';

let token;

test('scan routes flow', async (t) => {

  await t.test('unauthenticated scan list rejected', async () => {
    const r = await request(app).get('/api/scan');
    assert.equal(r.status, 401);
  });

  await t.test('login admin', async () => {
    const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
    assert.equal(r.status, 200);
    token = r.body.token;
  });

  let scanId;
  await t.test('queue nmap scan', async () => {
    const r = await request(app).post('/api/scan').set('Authorization','Bearer '+token).send({ target:'scanme.nmap.org', kind:'nmap' });
    assert.equal(r.status, 200);
    scanId = r.body.scan.id;
  });

  await t.test('fetch scan by id', async () => {
    const r = await request(app).get('/api/scan/'+scanId).set('Authorization','Bearer '+token);
    assert.equal(r.status, 200);
    assert.equal(r.body.scan.id, scanId);
  });

  await t.test('list scans new route', async () => {
    const r = await request(app).get('/api/scan').set('Authorization','Bearer '+token);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.scans));
  });

  await t.test('list scans legacy route', async () => {
    const r = await request(app).get('/api/scans').set('Authorization','Bearer '+token);
    assert.equal(r.status, 200);
  });

  await t.test('binaries endpoint', async () => {
    const r = await request(app).get('/api/scan/binaries').set('Authorization','Bearer '+token);
    assert.equal(r.status, 200);
    assert.ok(r.body.binaries);
  });
});
