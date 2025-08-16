// Central per-target scan rate limiter (in-DB window based on existing scans)
import { getTargetRateWindowMs, getTargetRateMaxForTarget } from './constants.js';
import { Scans } from './db.js';

export function checkTargetRateLimit(target){
  const windowMs = getTargetRateWindowMs();
  const max = getTargetRateMaxForTarget(target);
  if(!max || max<1) return { allowed:true, recent:0, limit:max };
  const since = Date.now() - windowMs;
  const recent = Scans.countRecentForTarget(target, since);
  if(recent >= max){
    return { allowed:false, recent, limit:max };
  }
  return { allowed:true, recent, limit:max };
}

export default { checkTargetRateLimit };
