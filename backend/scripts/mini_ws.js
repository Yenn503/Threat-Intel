// Standalone minimal WebSocket server (no Express) for isolation test
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const server = createServer();
const wss = new WebSocketServer({ server });
let count=0;
wss.on('connection', ws => {
  const id=++count;
  console.log('[MINI] connection #' + id);
  ws.on('message', m=> { try { ws.send(m); } catch{} });
  ws.on('close', c=> console.log('[MINI] close #' + id + ' code=' + c));
  ws.on('error', e=> console.log('[MINI] error #' + id + ' ' + e.message));
  try { ws.send('hello-mini'); } catch{}
});
server.listen(4100, ()=> console.log('[MINI] listening 4100'));
