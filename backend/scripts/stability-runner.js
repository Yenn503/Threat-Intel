// Runs test suite multiple times to detect flakiness
import { spawn } from 'child_process';

const LOOPS = parseInt(process.env.STABILITY_LOOPS || '3', 10);
let pass = 0;
let fail = 0;
let current = 0;

function runOnce(){
  current++;
  process.stdout.write(`\n[stability] Run ${current}/${LOOPS}\n`);
  const proc = spawn(process.execPath, ['--test', '--test-reporter', 'tap'], { env: { ...process.env, NODE_ENV:'test' }, stdio: 'inherit' });
  proc.on('exit', code => {
    if(code === 0) pass++; else fail++;
    if(current < LOOPS){
      runOnce();
    } else {
      console.log(`\n[stability] Completed ${LOOPS} runs: pass=${pass} fail=${fail}`);
      if(fail>0){
        process.exitCode = 1;
      }
    }
  });
}

runOnce();
