// Centralized API base + dynamic backend port discovery.
// In dev the backend may auto-shift (4000+n). We probe ports until one responds.
let discoveredPort = null;
let discovering = false;
const candidatePorts = [4000,4001,4002,4003,4004,4005];
let waiters = [];

async function probePort(p){
  try {
    // First try meta diagnostics for richer info
    const diag = await fetch(`http://localhost:${p}/api/meta/wsdiagnostics`, { method:'GET', cache:'no-store', headers:{ 'Accept':'application/json' }});
    if(diag.ok){
      const dj = await diag.json().catch(()=>null);
      if(dj && dj.port === p){ return true; }
    }
    const r = await fetch(`http://localhost:${p}/api/assess/health`, { method:'GET', cache:'no-store', headers:{ 'Accept':'application/json' }});
    if(!r.ok) return false;
    const ct = r.headers.get('content-type')||'';
    if(!/application\/json/i.test(ct)) return false;
    let data; try { data = await r.json(); } catch { return false; }
    if(data && data.ok === true){ return true; }
  } catch {}
  return false;
}

export async function discoverBackendPort(force=false){
  if((discoveredPort && !force) || discovering || (typeof window==='undefined')) return discoveredPort;
  discovering = true;
  let found = null;
  for(const p of candidatePorts){
    const ok = await probePort(p);
    if(ok){ found = p; break; }
  }
  // If we validated 4000, but server may have auto-shifted after WS creation error, query meta endpoint on 4000 to confirm actual.
  if(found === 4000){
    try {
      const r = await fetch('http://localhost:4000/api/meta/port', { cache:'no-store' });
      if(r.ok){ const j = await r.json(); if(j.port && j.port !== 4000){
        // Double-check that new port answers health
        const ok = await probePort(j.port);
        if(ok) found = j.port;
      } }
    } catch {}
  }
  discoveredPort = found || 4000; // fallback if none validated
  try { localStorage.setItem('ti_backend_port', String(discoveredPort)); } catch{}
  discovering = false;
  if(waiters.length){ waiters.forEach(r=> r(discoveredPort)); waiters=[]; }
  if(typeof window!== 'undefined'){ try { console.log('[apiClient] backend port', discoveredPort, found? '(validated)': '(fallback)'); } catch{} }
  return discoveredPort;
}

function ensurePortSync(){
  if(discoveredPort==null){
    try { const stored = localStorage.getItem('ti_backend_port'); if(stored) discoveredPort = parseInt(stored,10)||null; } catch{}
    if(discoveredPort==null && typeof window!=='undefined' && window.location.port!=='5173'){
      // If served from backend directly, use same origin (no port prefix needed)
      discoveredPort = window.location.port ? parseInt(window.location.port,10): null;
    }
  }
}

export function getApiBase(){
  if(typeof window==='undefined') return '';
  ensurePortSync();
  if(window.location.port !== '5173') return '';
  return `http://localhost:${discoveredPort||4000}`;
}

export async function apiFetch(path, opts={}){
  if(typeof window!=='undefined' && window.location.port==='5173' && discoveredPort==null){
    // kick off async discovery (fire and forget)
    discoverBackendPort();
  }
  const base = getApiBase();
  return fetch(base + path, opts);
}

export function wsUrl(path){
  const proto = (typeof window!=='undefined' && window.location.protocol==='https:')? 'wss':'ws';
  ensurePortSync();
  if(typeof window==='undefined') return `${proto}://localhost:4000${path}`;
  if(window.location.port==='5173'){
    return `${proto}://localhost:${discoveredPort||4000}${path}`;
  }
  return `${proto}://${window.location.host}${path}`;
}

export function initBackendDiscovery(){ if(typeof window!=='undefined'){ discoverBackendPort(true); setTimeout(()=> discoverBackendPort(true), 2500); } }
export function waitForBackendPort(){
  if(discoveredPort) return Promise.resolve(discoveredPort);
  if(typeof window==='undefined') return Promise.resolve(4000);
  discoverBackendPort();
  return new Promise(res=> waiters.push(res));
}
