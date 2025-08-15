// Simple timing summary script: runs test suite once (or multiple) and aggregates per-test durations.
import { spawn } from 'child_process';

const LOOPS = parseInt(process.env.TIMING_LOOPS || '1', 10);
const results = [];

function run(loop){
  return new Promise(resolve=>{
    const proc = spawn(process.execPath, ['--test', '--test-reporter', 'tap'], { env:{ ...process.env, NODE_ENV:'test' } });
    let buffer='';
    proc.stdout.on('data', d=>{ buffer += d.toString(); process.stdout.write(d); });
    proc.stderr.on('data', d=> process.stderr.write(d));
    proc.on('exit', code=>{
      const durations = [...buffer.matchAll(/duration_ms:\s*([0-9.]+)/g)].map(m=> parseFloat(m[1]));
      const total = durations.length? durations[durations.length-1]: NaN; // last is suite total
      results.push({ loop, code, total });
      resolve();
    });
  });
}

(async ()=>{
  for(let i=1;i<=LOOPS;i++){
    console.log(`\n[timing] Run ${i}/${LOOPS}`);
    await run(i);
  }
  const ok = results.filter(r=> r.code===0);
  const totals = ok.map(r=> r.total).filter(v=> Number.isFinite(v));
  const avg = totals.reduce((a,b)=> a+b,0)/(totals.length||1);
  const max = Math.max(...totals);
  const min = Math.min(...totals);
  console.log('\n[timing] Summary');
  console.log({ loops: LOOPS, passes: ok.length, fails: results.length-ok.length, avg_ms: Math.round(avg), min_ms: Math.round(min), max_ms: Math.round(max) });
})();
