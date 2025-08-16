import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:4501');
ws.on('open', ()=> console.log('[ALT] open'));
ws.on('message', m=> console.log('[ALT] msg', m.toString()));
ws.on('close', (c,r)=> console.log('[ALT] close', c, r));
ws.on('error', e=> console.log('[ALT] error', e.message));
setTimeout(()=> { try { ws.send('alt-ping'); } catch{} }, 200);
setTimeout(()=> ws.close(), 1200);
