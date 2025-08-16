// Simple Node-based WebSocket connectivity diagnostic
// Usage (PowerShell): node scripts/ws_check.js <jwt>
import WebSocket from 'ws';

const token = process.argv[2];
if(!token){
  console.error('Usage: node scripts/ws_check.js <jwt> [count]');
  process.exit(1);
}
const iterations = parseInt(process.argv[3]||'1',10);

function runOnce(i){
  return new Promise(res=>{
    const url = `ws://localhost:4000/ws/agent-events?token=${token}`;
    const ws = new WebSocket(url);
    const start = Date.now();
    let opened=false;
    ws.on('open', ()=>{ opened=true; console.log(`[${i}] open after ${Date.now()-start}ms`); });
    ws.on('message', m=>{ console.log(`[${i}] message len=${m.length} data=${m.toString().slice(0,80)}`); });
    ws.on('close', (code, reason)=>{ console.log(`[${i}] close code=${code} reason=${reason}`); res({ opened, code, ms: Date.now()-start }); });
    ws.on('error', e=>{ console.log(`[${i}] error ${e.message}`); });
  });
}

(async()=>{
  for(let i=1;i<=iterations;i++){
    const r = await runOnce(i);
    await new Promise(r=> setTimeout(r, 300));
  }
})();
