import test from 'node:test';
import assert from 'node:assert';
import fetch from 'node-fetch';

process.env.NODE_ENV='test';
process.env.JWT_SECRET='test-secret';

let server; let base;
test('setup server', async (t) => {
  const mod = await import('../src/server.js');
  server = mod.server;
  await new Promise(r=>server.listen(0,r));
  base = `http://127.0.0.1:${server.address().port}`;
  t.diagnostic('server started '+base);
});

test('GET /api/agent/status returns agents', async () => {
  // Need a token: seed admin user is created automatically (admin@example.com / password)
  const loginRes = await fetch(base+'/api/auth/login',{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email:'admin@example.com', password:'password'}) });
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();
  const res = await fetch(base+'/api/agent/status', { headers:{ Authorization:'Bearer '+token }});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.ok(Array.isArray(body.agents));
});

test('GET /api/agent/queue returns queue', async () => {
  const loginRes = await fetch(base+'/api/auth/login',{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email:'admin@example.com', password:'password'}) });
  const { token } = await loginRes.json();
  const res = await fetch(base+'/api/agent/queue', { headers:{ Authorization:'Bearer '+token }});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.ok(Array.isArray(body.queue));
});

test('teardown server', async () => {
  await new Promise(r=>server.close(r));
});
