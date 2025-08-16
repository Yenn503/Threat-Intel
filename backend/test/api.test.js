import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';

// Ensure test mode before importing server (memory DB)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { db, resetAll, seedAdmin, Users } from '../src/db.js';
import bcrypt from 'bcryptjs';

let adminToken; let userToken; let createdTechniqueId; let base; let server; let app;

async function api(method, path, body, token){
  const res = await fetch(base+path, {
    method,
    headers: { 'content-type':'application/json', ...(token? { Authorization: 'Bearer '+token }: {}) },
    body: body? JSON.stringify(body): undefined
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

describe('Threat-Intel minimal API suite', () => {
  before(async (t) => {
    resetAll();
    seedAdmin(bcrypt);
    // Dynamically import server AFTER env flags so it does not auto listen
    const mod = await import('../src/server.js');
    server = mod.server; app = mod.app;
    await new Promise(resolve => {
      server.listen(0, () => {
        const addr = server.address();
        base = `http://127.0.0.1:${addr.port}`;
        try { if(t && typeof t.diagnostic === 'function') t.diagnostic('listening on '+base); } catch {}
        resolve();
      });
    });
  });

  after(() => {
    server.close();
  });

  it('logs in seeded admin', async () => {
    const res = await api('POST','/api/auth/login',{ email: 'admin@example.com', password: 'password' });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    adminToken = res.body.token;
  });

  it('registers a normal user & fetches /me', async () => {
    const res = await api('POST','/api/auth/register',{ email: 'user1@example.com', password: 'pass1234' });
    assert.equal(res.status, 200);
    userToken = res.body.token;
    const me = await api('GET','/api/auth/me',null,userToken);
    assert.equal(me.status, 200);
    assert.equal(me.body.email, 'user1@example.com');
  });

  it('prevents non-admin technique create', async () => {
    const res = await api('POST','/api/techniques',{ category:'privesc', name:'Test Technique', description:'x', template:'echo test' }, userToken);
    assert.equal(res.status, 403);
  });

  it('admin creates technique', async () => {
    const res = await api('POST','/api/techniques',{ category:'privesc', name:'Test Technique', description:'x', template:'echo test' }, adminToken);
    assert.equal(res.status, 200);
    assert.ok(res.body.technique.id);
    createdTechniqueId = res.body.technique.id;
  });

  it('admin updates technique and creates version snapshot', async () => {
    const res = await api('PUT',`/api/techniques/${createdTechniqueId}`,{ description:'updated desc' },adminToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.technique.description, 'updated desc');
    const versions = await api('GET',`/api/techniques/${createdTechniqueId}/versions`,null,adminToken);
    assert.equal(versions.status, 200);
    assert.ok(Array.isArray(versions.body.versions));
    assert.equal(versions.body.versions.length, 1);
  });

  it('admin changes status to draft', async () => {
    const res = await api('PATCH',`/api/techniques/${createdTechniqueId}/status`,{ status:'draft' },adminToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.technique.status, 'draft');
  });

  it('non-admin cannot list all techniques including draft', async () => {
    const res = await api('GET','/api/techniques?all=1',null,userToken);
    // Should ignore all=1 for non-admin and only return published (0 because ours is draft)
    assert.equal(res.status, 200);
    assert.equal(res.body.techniques.length, 0);
  });

  it('metrics endpoint returns counts & recent activity (user sees own only)', async () => {
    const res = await api('GET','/api/metrics',null,userToken);
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.users === 'number');
    assert.ok(Array.isArray(res.body.series));
  });

  it('admin sees metrics including recent full activity list subset', async () => {
    const res = await api('GET','/api/metrics',null,adminToken);
    assert.equal(res.status, 200);
    assert.ok(res.body.metrics.techniqueCreates >= 1);
  });
});
