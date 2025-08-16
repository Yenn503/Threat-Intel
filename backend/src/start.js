import { server } from './server.js';

// Attempt to listen on configured port; on EADDRINUSE, auto-increment a few times (dev convenience)
const BASE_PORT = parseInt(process.env.PORT || '4000',10);
const MAX_TRIES = parseInt(process.env.PORT_RETRY_LIMIT || '5',10); // try 5 sequential ports by default

function attempt(port, remaining){
  server.listen(port, () => {
    if(port !== BASE_PORT) console.warn(`[server] Port ${BASE_PORT} busy; using fallback ${port}`);
    process.env.ACTUAL_PORT = String(port);
    console.log('Backend listening on ' + port);
    console.log('Assessment routes: /api/assess/whois , /api/assess/shodan');
  }).on('error', (err)=>{
    if(err.code === 'EADDRINUSE' && remaining>0){
      console.warn(`[server] Port ${port} in use, retrying on ${port+1} (remaining attempts: ${remaining})`);
      setTimeout(()=> attempt(port+1, remaining-1), 250);
    } else {
      console.error('[server] Failed to bind port:', err.message);
      process.exit(1);
    }
  });
}

attempt(BASE_PORT, MAX_TRIES);
