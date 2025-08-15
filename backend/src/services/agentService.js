import { v4 as uuidv4 } from 'uuid';
import { db, Scans, ScanRecs, AIMessages, AITasks } from '../db.js';
import { executeToolStep } from '../aiTools.js';
import { enqueueScan } from './scanService.js';
import { nextRunnableSteps, canRunStep } from './orchestratorService.js';
import { logStepTransition, logger } from '../logger.js';

let agentLoopRunning = false;
let loopStarted = false;
const LOOP_INTERVAL_MS = process.env.NODE_ENV==='test' ? 150 : 3000;

export function planFromInstruction(instr){
  const lower = (instr||'').toLowerCase();
  const m = lower.match(/(scan & summarize|nmap then nuclei)\s+([a-z0-9_.:-]+)/);
  if(m){
    const target = m[2];
    return [
      { step:1, action:'queue-scan', kind:'nmap', target, flags:'-F', status:'pending' },
      { step:2, action:'await-scan', kind:'nmap', target, status:'pending' },
      { step:3, action:'queue-scan', kind:'nuclei', target, flags:'-severity medium,high,critical', status:'pending' },
      { step:4, action:'await-scan', kind:'nuclei', target, status:'pending' },
      { step:5, action:'summarize', target, status:'pending' }
    ];
  }
  return null;
}

async function agentLoop(){
  if(agentLoopRunning) return; agentLoopRunning = true;
  try {
    const work = AITasks.queued();
    for(const task of work){
      let plan = []; try { plan = JSON.parse(task.plan_json||'[]'); } catch { plan=[]; }
      let mutated = false;
      // Reconcile running queue-scan steps whose scans have finished
      for(const qs of plan){
        if(qs.action==='queue-scan' && qs.status==='running' && qs.scanId){
          const scan = Scans.get(qs.scanId);
            if(scan){
              if(scan.status==='completed'){ qs.status='done'; mutated=true; }
              else if(scan.status==='failed'){ qs.status='error'; qs.error='scan failed'; mutated=true; }
            }
        }
      }
  // Multi-agent dependency + concurrency aware selection
      const runnable = nextRunnableSteps(plan).filter(s=> canRunStep(s, plan));
      const iterationSet = runnable.length? runnable : plan;
      for(const step of iterationSet){
        // If not runnable due to dependency (in fallback path), continue
        if(step.status==='pending' && Array.isArray(step.dependsOn) && step.dependsOn.length){
          const unmet = step.dependsOn.some(d=> {
            const dep = plan.find(p=> (p.idx===d || p.step===d));
            return !dep || dep.status!=='done';
          });
            if(unmet && runnable.length===0) continue; // fallback path skip
        }
        if(step.waitForScan && step.status==='waiting' && step.scanId){
          const scan = Scans.get(step.scanId);
          if(scan){
            if(scan.status==='failed'){ step.status='error'; step.error='scan failed'; mutated=true; AIMessages.add(task.user_id,'assistant', `${step.tool||step.kind} scan failed for ${scan.target}`); }
            else if(scan.status==='completed'){
              step.status='done'; mutated=true;
              try {
                const sum = JSON.parse(scan.summary_json||'{}');
                if(scan.type==='nmap') AIMessages.add(task.user_id,'assistant', `nmap complete: ${(sum.openPorts||[]).slice(0,10).map(p=>p.port+'/'+p.service).join(', ') || 'no open ports'}`);
                else if(scan.type==='nuclei') AIMessages.add(task.user_id,'assistant', `nuclei complete: ${(sum.findings||[]).length} findings`);
              } catch {}
            }
          }
          continue;
        }
  if(step.status!=='pending') continue;
        if(step.tool){
          try {
            const prev = step.status; step.status='running'; mutated=true; logStepTransition(task.id, step, prev, step.status); AITasks.updatePlan(task.id, plan);
            AIMessages.add(task.user_id,'assistant', `Running ${step.tool} ${step.args? JSON.stringify(step.args):''}`);
            const result = await executeToolStep(step, task.user_id, enqueueScan);
            if(result && result.scanId){
              step.scanId = result.scanId; step.waitForScan = true; const prev2 = step.status; step.status='waiting'; logStepTransition(task.id, step, prev2, step.status);
            } else { step.result = result; const prev2 = step.status; step.status='done'; logStepTransition(task.id, step, prev2, step.status); AIMessages.add(task.user_id,'assistant', `${step.tool} done.`); }
          } catch(e){ const prev2 = step.status; step.status='error'; step.error=e.message.slice(0,200); logStepTransition(task.id, step, prev2, step.status); logger.error('tool_step_error',{ taskId:task.id, step: step.idx, err:e.message }); }
          mutated=true; break;
        }
        if(step.action==='queue-scan'){
          const recent = db.prepare('SELECT id,status FROM scans WHERE target=? AND type=? ORDER BY created_at DESC LIMIT 5').all(step.target, step.kind);
          const existing = recent.find(r=> r.status==='completed');
          if(existing){ step.scanId = existing.id; step.status='done'; mutated=true; continue; }
          const baseBin = step.kind==='nmap'? (process.env.NMAP_PATH||'nmap') : (process.env.NUCLEI_PATH||'nuclei');
          const flags = step.flags||''; const safeFlags = String(flags).replace(/[^A-Za-z0-9_:\-\s\/\.]/g,'');
          const cmd = step.kind==='nmap'? `${baseBin} -Pn -sV ${safeFlags} ${step.target}` : `${baseBin} -u ${step.target} ${safeFlags}`;
          const id = uuidv4();
          Scans.create({ id, user_id:task.user_id, target:step.target, type:step.kind, command:cmd });
          enqueueScan({ id, type:step.kind, command:cmd, target:step.target });
          step.scanId = id; const prev = step.status; step.status='running'; logStepTransition(task.id, step, prev, step.status); mutated=true; break;
        } else if(step.action==='await-scan' || step.waitForScan){
          if(!step.scanId){ const prev = plan.find(p=> p.action==='queue-scan' && p.kind===step.kind && p.target===step.target && p.scanId); if(prev) step.scanId=prev.scanId; else { step.status='error'; step.error='missing scan ref'; mutated=true; break; } }
          const scan = Scans.get(step.scanId);
          if(!scan){ step.status='error'; step.error='scan missing'; mutated=true; break; }
          if(scan.status==='failed'){ step.status='error'; step.error='scan failed'; mutated=true; break; }
          if(scan.status==='completed'){ const prev = step.status; step.status='done'; logStepTransition(task.id, step, prev, step.status); mutated=true; continue; }
          break; // still running
        } else if(step.action==='summarize'){
          const lastNmap = db.prepare("SELECT * FROM scans WHERE target=? AND type='nmap' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(step.target);
          const lastNuclei = db.prepare("SELECT * FROM scans WHERE target=? AND type='nuclei' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(step.target);
          let nmapSummary={}, nucleiSummary={};
          try { nmapSummary = JSON.parse(lastNmap?.summary_json||'{}'); } catch{}
          try { nucleiSummary = JSON.parse(lastNuclei?.summary_json||'{}'); } catch{}
          const recs = lastNuclei? ScanRecs.listForScan(lastNuclei.id): [];
          const textSummary = `Summary for ${step.target}:\nOpen Ports: ${(nmapSummary.openPorts||[]).map(p=>p.port+'/'+p.service).join(', ')||'none'}\nFindings: ${(nucleiSummary.findings||[]).length} issues (critical:${(nucleiSummary.findings||[]).filter(f=>f.severity==='critical').length}, high:${(nucleiSummary.findings||[]).filter(f=>f.severity==='high').length}, medium:${(nucleiSummary.findings||[]).filter(f=>f.severity==='medium').length})\nTop Recommendations:\n${recs.slice(0,5).map(r=> '- '+r.text).join('\n') || 'None'}\n`;
          step.result = { text: textSummary }; const prev = step.status; step.status='done'; logStepTransition(task.id, step, prev, step.status); mutated=true;
        }
      }
      if(mutated){ AITasks.updatePlan(task.id, plan); }
      const unfinished = plan.some(s=> ['pending','running'].includes(s.status) || (s.waitForScan && s.status==='waiting'));
      if(plan.length && !unfinished){
        const summaryStep = plan.find(s=> s.action==='summarize') || plan.find(s=> s.tool==='summarize_target');
        AITasks.complete(task.id, { summary: summaryStep?.result?.text || summaryStep?.result });
        AIMessages.add(task.user_id,'assistant', summaryStep?.result?.text || 'Task complete.');
      }
    }
  } catch {/* swallow */ }
  agentLoopRunning = false;
  setTimeout(agentLoop, LOOP_INTERVAL_MS).unref();
}

export function startAgentLoop(){
  if(loopStarted) return; loopStarted = true;
  if(process.env.NODE_ENV==='test'){
    // Kick off immediately for faster test progression
    agentLoop();
  } else {
    setTimeout(agentLoop, LOOP_INTERVAL_MS).unref();
  }
}

export default { startAgentLoop, planFromInstruction };
