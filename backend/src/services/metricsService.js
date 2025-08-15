// Task timeline & duration metrics computation
import { AITasks } from '../db.js';

export function computeTaskTimeline(task){
  if(!task) return null;
  let plan=[]; try { plan = JSON.parse(task.plan_json||'[]'); } catch { plan=[]; }
  const now = Date.now();
  const steps = plan.map(s=> {
    const startedAt = s.startedAt || null;
    const completedAt = s.completedAt || null;
    let durationMs = null;
    if(startedAt && completedAt) durationMs = completedAt - startedAt;
    else if(startedAt && !completedAt && task.status!=='completed' && task.status!=='failed') durationMs = now - startedAt;
    return {
      idx: s.idx ?? s.step,
      tool: s.tool || s.action || null,
      agent: s.agent || null,
      status: s.status,
      startedAt,
      completedAt,
      durationMs: typeof durationMs==='number' ? durationMs : null
    };
  });
  const started = steps.filter(s=> s.startedAt).map(s=> s.startedAt);
  const finished = steps.filter(s=> s.completedAt).map(s=> s.completedAt);
  const firstStart = started.length? Math.min(...started): null;
  const lastComplete = finished.length? Math.max(...finished): (task.status==='completed'? (started.length? Math.max(...started): null): null);
  const overallDurationMs = (firstStart!=null && lastComplete!=null) ? (lastComplete - firstStart) : null;
  const doneDurations = steps.filter(s=> typeof s.durationMs==='number');
  const totalStepDurationsMs = doneDurations.reduce((a,b)=> a + (b.durationMs||0), 0);
  const avgStepDurationMs = doneDurations.length? Math.round(totalStepDurationsMs / doneDurations.length) : null;
  const activeUtilization = overallDurationMs && totalStepDurationsMs ? +(totalStepDurationsMs / overallDurationMs).toFixed(3) : null;
  return {
    taskId: task.id,
    status: task.status,
    overallDurationMs,
    totalStepDurationsMs,
    avgStepDurationMs,
    activeUtilization,
    stepCount: steps.length,
    steps
  };
}

export default { computeTaskTimeline };
