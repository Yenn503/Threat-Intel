// Multi-agent Orchestrator (Phase 1 scaffold)
// Goal: Provide a thin compatibility layer so future agents (recon, vuln, validate, report)
// can be introduced without breaking existing single-plan execution.
// For now, we simply tag steps with a default agent if missing and expose a hook
// to transform incoming plans.

const DEFAULT_AGENT = 'recon';

// Agent registry definition (Phase 2) now composed from dedicated stubs (extensible)
import { reconAgent } from '../agents/reconAgent.js';
import { vulnAgent } from '../agents/vulnAgent.js';
import { validationAgent } from '../agents/validationAgent.js';
import { reportingAgent } from '../agents/reportingAgent.js';
const agentRegistry = { [reconAgent.id]:reconAgent, [vulnAgent.id]:vulnAgent, [validationAgent.id]:validationAgent, [reportingAgent.id]:reportingAgent };

export function listAgents(){
  return Object.entries(agentRegistry).map(([id, a])=> ({ id, description:a.description, concurrency:a.concurrency }));
}

export function normalizeMultiAgentPlan(rawSteps){
  if(!Array.isArray(rawSteps)) return [];
  return rawSteps.map((s,i)=> ({ ...s, agent: s.agent || pickAgentForStep(s) || DEFAULT_AGENT, idx: s.idx!==undefined? s.idx : i }));
}

// Static cycle detection (simple DFS over dependsOn graph)
export function detectPlanCycle(steps){
  const map = new Map(); steps.forEach(s=> map.set(s.idx ?? s.step, s));
  const visiting = new Set(); const visited = new Set();
  function dfs(nodeId){
    if(visiting.has(nodeId)) return true; // cycle
    if(visited.has(nodeId)) return false;
    visiting.add(nodeId);
    const s = map.get(nodeId); if(s){
      const deps = Array.isArray(s.dependsOn)? s.dependsOn: [];
      for(const d of deps){ if(dfs(d)) return true; }
    }
    visiting.delete(nodeId); visited.add(nodeId); return false;
  }
  for(const id of map.keys()){ if(dfs(id)) return true; }
  return false;
}

function pickAgentForStep(step){
  // Determine agent by ownership predicate
  for(const [id, def] of Object.entries(agentRegistry)){
    try { if(def.owns(step)) return id; } catch { /* ignore */ }
  }
  return DEFAULT_AGENT;
}

// Determine runnable steps based on dependency completion
export function nextRunnableSteps(plan){
  const byIdx = new Map();
  for(const s of plan){ byIdx.set(s.idx ?? s.step, s); }
  return plan.filter(s=> {
    if(s.status!=='pending') return false;
    const deps = Array.isArray(s.dependsOn)? s.dependsOn: [];
    return deps.every(d=> {
      const dep = byIdx.get(d); return dep && dep.status==='done';
    });
  });
}

// Enforce per-agent concurrency (count running steps per agent)
export function agentConcurrencyState(plan){
  const counts = {}; for(const s of plan){ if(['running','waiting'].includes(s.status)){ counts[s.agent] = (counts[s.agent]||0)+1; } }
  return counts;
}

export function canRunStep(step, plan){
  const def = agentRegistry[step.agent] || agentRegistry[DEFAULT_AGENT];
  const counts = agentConcurrencyState(plan);
  return (counts[step.agent]||0) < def.concurrency;
}

export default { normalizeMultiAgentPlan, nextRunnableSteps, listAgents, canRunStep, detectPlanCycle };
