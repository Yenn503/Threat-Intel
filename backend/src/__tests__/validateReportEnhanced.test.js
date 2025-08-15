process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../server.js';
import scanService from '../services/scanService.js';
import { Scans } from '../db.js';
import { startAgentLoop } from '../services/agentService.js';

const sleep = ms=> new Promise(r=> setTimeout(r, ms));
// Inject scan executor producing a nuclei finding we'll validate
scanService.setExecutor(async (task)=>{ Scans.markRunning(task.id); await sleep(5); if(task.type==='nmap'){ Scans.complete(task.id,'OUT',{ openPorts:[{ port:80, service:'http'}] },0); } else { Scans.complete(task.id,'OUT',{ findings:[{ id:'tmpl-123', severity:'high', evidence:'banner match'}] },0); } });
startAgentLoop();

let token;

test('login admin', async ()=>{ const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' }); assert.equal(r.status,200); token=r.body.token; });

test('enhanced validate/report logic identifies finding presence', async ()=>{
  const plan = [
    { tool:'nmap_scan', args:{ target:'scanme.nmap.org' } },
    { tool:'nuclei_scan', args:{ target:'scanme.nmap.org' }, dependsOn:[0] },
    { tool:'report_findings', args:{ target:'scanme.nmap.org' }, dependsOn:[1] },
    { tool:'validate_finding', args:{ target:'scanme.nmap.org', findingId:'tmpl-123' }, dependsOn:[2] },
    { tool:'validate_finding', args:{ target:'scanme.nmap.org', findingId:'missing-xyz' }, dependsOn:[2] }
  ];
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Enhanced validate test', plan });
  assert.equal(exec.status,200);
  const id = exec.body.task.id;
  let task=null; for(let i=0;i<70;i++){ await sleep(80); const r= await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token); task=r.body.task; if(task.status==='completed') break; }
  assert.ok(task && task.status==='completed','task completed');
  const steps = JSON.parse(task.plan_json); const v1 = steps.find(s=> s.args?.findingId==='tmpl-123'); const v2 = steps.find(s=> s.args?.findingId==='missing-xyz');
  assert.ok(v1 && v1.result && v1.result.validated===true && v1.result.exists===true,'existing finding validated');
  assert.ok(v2 && v2.result && v2.result.validated===false && v2.result.exists===false,'missing finding flagged');
});
