// Plan validation & sanitization utilities for agent tasks and AI routes
// A plan is an array of step objects. We constrain fields to reduce risk of unexpected shapes.

const ALLOWED_STEP_KEYS = new Set(['step','idx','action','tool','kind','target','flags','args','status','scanId','waitForScan','result','error']);
const ALLOWED_STATUS = new Set(['pending','running','waiting','done','error']);

export function parsePlanString(raw){
  if(!raw) return [];
  try { const parsed = JSON.parse(raw); return sanitizePlan(parsed); } catch { return []; }
}

export function sanitizePlan(maybe){
  if(!Array.isArray(maybe)) return [];
  const out = [];
  for(const orig of maybe.slice(0,50)){ // hard cap length
    if(!orig || typeof orig !== 'object') continue;
    const step = {};
    for(const k of Object.keys(orig)){
      if(ALLOWED_STEP_KEYS.has(k)) step[k] = orig[k];
    }
    if(step.status && !ALLOWED_STATUS.has(step.status)) step.status='pending';
    if(!step.status) step.status='pending';
    if(step.tool && typeof step.tool !== 'string') delete step.tool;
    if(step.action && typeof step.action !== 'string') delete step.action;
    if(step.tool || step.action){ out.push(step); }
  }
  return out;
}

export function toStoredPlan(plan){
  return JSON.stringify(sanitizePlan(plan));
}

export default { parsePlanString, sanitizePlan, toStoredPlan };
