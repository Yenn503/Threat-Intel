// Plan validation & sanitization utilities for agent tasks and AI routes
// A plan is an array of step objects. We constrain fields to reduce risk of unexpected shapes.

// Phase 1 multi-agent scaffold: allow optional 'agent' designator on steps
const ALLOWED_STEP_KEYS = new Set(['step','idx','action','tool','kind','target','flags','args','status','scanId','waitForScan','result','error','agent','dependsOn','depsPending','startedAt','completedAt']);
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

// Validate steps against tool schemas (if provided). Non-tool action steps are passed through after sanitization.
export function validatePlanSteps(plan, toolRegistry){
  const sanitized = sanitizePlan(plan);
  if(!toolRegistry) return sanitized;
  const out = [];
  for(const step of sanitized){
    if(step.tool){
      const tool = toolRegistry[step.tool];
      if(!tool){ continue; }
      const schema = tool.schema || {};
      const args = step.args || {};
      let valid = true;
      if(schema.required){
        for(const r of schema.required){ if(args[r]===undefined){ valid=false; break; } }
      }
      if(valid && schema.properties){
        for(const [k,v] of Object.entries(schema.properties)){
          if(args[k]!==undefined && v.type && typeof args[k] !== v.type){ valid=false; break; }
        }
      }
      if(!valid) continue;
      // Shallow clone & normalized args
      step.args = args;
      out.push(step);
    } else {
      // Non-tool step (queue-scan / await-scan / summarize etc.)
      out.push(step);
    }
  }
  return out;
}

export default { parsePlanString, sanitizePlan, toStoredPlan, validatePlanSteps };
