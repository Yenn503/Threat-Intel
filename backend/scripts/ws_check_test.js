import WebSocket from 'ws';
const token = process.argv[2];
if(!token){ console.error('Usage: node scripts/ws_check_test.js <jwt>'); process.exit(1);} 
const url = `ws://localhost:4000/ws/test?token=${token}`;
const ws = new WebSocket(url);
ws.on('open', ()=> console.log('open test endpoint'));
ws.on('message', m=> console.log('msg', m.toString()));
ws.on('close', (c,r)=> console.log('close test', c, r));
ws.on('error', e=> console.log('error test', e.message));
