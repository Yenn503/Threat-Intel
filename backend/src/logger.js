// Simple structured logger (no external dependency)
// Usage: import { logger } from './logger.js'; logger.info('message', { extra:'meta' });

const LEVELS = ['debug','info','warn','error'];
const CURRENT_LEVEL = (process.env.LOG_LEVEL||'info').toLowerCase();
const LEVEL_INDEX = LEVELS.indexOf(CURRENT_LEVEL);

function emit(level, msg, meta){
  const idx = LEVELS.indexOf(level);
  if(idx < 0) return;
  if(LEVEL_INDEX >=0 && idx < LEVEL_INDEX) return;
  const rec = { ts: new Date().toISOString(), level, msg, ...meta };
  // Ensure errors serialize cleanly
  if(rec.err instanceof Error){
    const e = rec.err;
    rec.err = { message:e.message, stack: process.env.NODE_ENV==='production'? undefined : e.stack };
  }
  const line = JSON.stringify(rec);
  if(level==='error') console.error(line); else if(level==='warn') console.warn(line); else console.log(line);
}

export const logger = {
  debug:(m,meta={})=> emit('debug',m,meta),
  info:(m,meta={})=> emit('info',m,meta),
  warn:(m,meta={})=> emit('warn',m,meta),
  error:(m,meta={})=> emit('error',m,meta)
};

export function logStepTransition(taskId, step, prevStatus, nextStatus){
  const evt = { taskId, idx: step.idx ?? step.step, agent: step.agent, tool: step.tool||step.action, prevStatus, nextStatus, ts: Date.now() };
  logger.debug('step_transition', evt);
  recordAgentEvent({ type:'step', ...evt });
}

// --- Agent event ring buffer ---
const agentEvents = [];
let agentEventSeq = 0;
export function recordAgentEvent(evt){
  const rec = { id: ++agentEventSeq, ts: Date.now(), ...evt };
  agentEvents.push(rec);
  if(agentEvents.length > 400) agentEvents.splice(0, agentEvents.length-400);
  // Persist asynchronously (best-effort, ignore errors & avoid circular import at module load)
  try {
    // Defer import so we don't create a hard circular dependency at top-level
    Promise.resolve().then(()=> import('./db.js')).then(mod=>{
      if(mod && mod.AgentEvents){
        mod.AgentEvents.record({ type: rec.type, taskId: rec.taskId, agent: rec.agent, tool: rec.tool, data: rec });
      }
    }).catch(()=>{});
  } catch {}
  return rec.id;
}
export function recentAgentEvents(limit=25){
  return agentEvents.slice(-limit);
}
