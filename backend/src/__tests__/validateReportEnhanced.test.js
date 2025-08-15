process.env.NODE_ENV='test';
process.env.ENABLE_LLM_TESTS='0';
process.env.DISABLE_AUTO_AGENT_LOOP='1';
import { addAllowlistHosts, ensureHighDefaultLimits } from './testEnvUtils.js';
addAllowlistHosts(['*']);
ensureHighDefaultLimits();
import { isolateDb } from './testEnvUtils.js';
await isolateDb('validateReportEnhanced');
process.env.TARGET_RATE_WINDOW_MS='2000';
process.env.TARGET_RATE_MAX='5';
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

async function ensureLogin(){
  if(token) return token;
  const r = await request(app).post('/api/auth/login').send({ email:'admin@example.com', password:'password' });
  assert.equal(r.status,200); token=r.body.token; return token;
}

test('login admin', async ()=>{ await ensureLogin(); });

test('enhanced validate/report logic identifies finding presence', async ()=>{
  await ensureLogin();
  const target = 'validate-' + Date.now().toString(36) + '.test';
  // Extend allowlist dynamically to include unique target using merge util to avoid clobbering other tests running in parallel
  await (async ()=>{ const { addAllowlistHosts } = await import('./testEnvUtils.js'); addAllowlistHosts([target]); })();
  // Clear any prior scans for this target (isolation)
  const { db } = await import('../db.js');
  db.prepare('DELETE FROM scans WHERE target=?').run(target);
  const plan = [
    { tool:'nmap_scan', args:{ target } },
    { tool:'nuclei_scan', args:{ target }, dependsOn:[0] },
    { tool:'report_findings', args:{ target }, dependsOn:[1] },
    { tool:'validate_finding', args:{ target, findingId:'tmpl-123' }, dependsOn:[2] },
    { tool:'validate_finding', args:{ target, findingId:'missing-xyz' }, dependsOn:[2] }
  ];
  // Clear any residual scans for reused hostnames (defensive)
  const preDb = await import('../db.js'); preDb.db.prepare('DELETE FROM scans WHERE target LIKE ?').run('validate-%');
  const exec = await request(app).post('/api/ai/agent/execute').set('Authorization','Bearer '+token).send({ instruction:'Enhanced validate test', plan });
  assert.ok(exec && typeof exec.status==='number','execute response present');
  assert.equal(exec.status,200,'execute returned 200');
  const id = exec.body.task.id;
  // Sanity fetch
  const firstFetch = await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token);
  assert.equal(firstFetch.status,200,'initial task fetch 200');
  let task=null; let lastStatuses=''; for(let i=0;i<260;i++){ 
    // drive faster: multiple ticks per outer loop to hasten dependent steps
    await import('../services/agentService.js').then(m=> m.runAgentOnce());
    await import('../services/agentService.js').then(m=> m.runAgentOnce());
    await sleep(25);
    const r= await request(app).get('/api/ai/agent/tasks/'+id).set('Authorization','Bearer '+token); if(r.status!==200){ continue; } task=r.body.task; const steps = task && task.plan_json? JSON.parse(task.plan_json):[]; const haveValidateResults = steps.filter(s=> s.tool==='validate_finding' && s.result).length===2; const statuses = steps.map(s=> s.status).join(','); if(statuses!==lastStatuses){ lastStatuses=statuses; }
    if(task && (task.status==='completed' || haveValidateResults)) break; }
  // If not completed via API, fallback read from db (some prior flakiness observed)
  if(!task || task.status!=='completed'){
    try { const {db}=await import('../db.js'); const raw = db.prepare('SELECT * FROM ai_tasks WHERE id=?').get(id); if(raw){ task=raw; } } catch{}
  }
  assert.ok(task,'task fetched');
  assert.equal(task.status,'completed','task completed');
  const steps = JSON.parse(task.plan_json||'[]');
  // All steps should be terminal
  assert.ok(steps.length>=5 && steps.every(s=> ['done','error'].includes(s.status)),'all steps terminal');
  const v1 = steps.find(s=> s.tool==='validate_finding' && s.args && s.args.findingId==='tmpl-123');
  const v2 = steps.find(s=> s.tool==='validate_finding' && s.args && s.args.findingId==='missing-xyz');
  assert.ok(v1 && v1.result && v1.result.validated===true,'expected finding validated');
  assert.ok(v2 && v2.result && v2.result.validated===false,'expected missing finding not validated');
});
