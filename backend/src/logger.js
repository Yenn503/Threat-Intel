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
  logger.debug('step_transition', { taskId, idx: step.idx ?? step.step, agent: step.agent, tool: step.tool||step.action, prevStatus, nextStatus });
}
