import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:4100');
ws.on('open', ()=> console.log('[MINI-C] open'));
ws.on('message', m=> console.log('[MINI-C] msg', m.toString()));
ws.on('close', (c,r)=> console.log('[MINI-C] close', c, r));
ws.on('error', e=> console.log('[MINI-C] error', e.message));
setTimeout(()=> ws.send('ping-mini'), 300);
setTimeout(()=> ws.close(), 1500);
