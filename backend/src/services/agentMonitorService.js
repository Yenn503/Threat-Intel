// Agent Monitor: derives real-time agent status snapshots for UI panel
import { AITasks } from '../db.js';

const AGENTS = ['recon','vuln','validate','report'];

export function getAgentStatusList(){
  const tasks = AITasks.queued();
  const agentStates = AGENTS.map(a=> ({ agent:a, status:'idle', target:null, lastRun:null }));
  function stateFor(a){ return agentStates.find(s=> s.agent===a); }
  for(const t of tasks){
    let plan=[]; try { plan = JSON.parse(t.plan_json||'[]'); } catch{}
    for(const step of plan){
      const a = step.agent || 'recon';
      const st = stateFor(a); if(!st) continue;
      if(['running','waiting'].includes(step.status)){
        st.status='running'; st.target = step.args?.target || step.target || st.target;
      } else if(step.status==='pending' && st.status!=='running'){
        if(st.status!=='queued') st.status='queued';
        st.target = st.target || step.args?.target || step.target || null;
      } else if(['done','error'].includes(step.status) && step.completedAt){
        if(!st.lastRun || step.completedAt > st.lastRun) st.lastRun = step.completedAt;
      }
    }
  }
  agentStates.forEach(s=> { if(s.lastRun) s.lastRunIso = new Date(s.lastRun).toISOString(); });
  return agentStates;
}

export function getQueueOverview(limit=5){
  const tasks = AITasks.queued();
  const items = [];
  for(const t of tasks){
    let plan=[]; try { plan = JSON.parse(t.plan_json||'[]'); } catch{}
    const pending = plan.filter(s=> s.status==='pending').length;
    const running = plan.filter(s=> ['running','waiting'].includes(s.status)).length;
    const total = plan.length;
    const priority = running>0? 1 : Math.max(2, pending+1);
    const etaSec = pending * 5; // heuristic placeholder
    items.push({ id:t.id, createdAt:t.created_at, status:t.status, pending, running, total, priority, etaSec });
  }
  return items.sort((a,b)=> a.priority-b.priority || a.createdAt - b.createdAt).slice(0,limit);
}

export default { getAgentStatusList, getQueueOverview };
