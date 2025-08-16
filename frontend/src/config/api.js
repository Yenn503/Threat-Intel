// Central API + WS base and safeFetch helper with exponential backoff capability.
export const API_BASE = 'http://localhost:4000';

// Basic exponential backoff with jitter (ms)
function computeDelay(attempt, base=1000, max=30000){
  const exp = Math.min(max, base * Math.pow(2, attempt));
  const jitter = Math.random() * Math.min(1000, exp*0.25);
  return exp + jitter;
}

export async function safeFetch(path, { method='GET', headers={}, body, token, expectJson=true, retries=0, retryOnStatuses=[502,503,504], signal } = {}){
  const url = path.startsWith('http') ? path : API_BASE + path;
  const finalHeaders = { ...headers };
  if(token) finalHeaders.Authorization = 'Bearer '+token;
  if(body && !finalHeaders['Content-Type']) finalHeaders['Content-Type'] = 'application/json';
  let attempt=0; let lastErr;
  while(true){
    try {
      const res = await fetch(url, { method, headers: finalHeaders, body, signal });
      if(retryOnStatuses.includes(res.status) && attempt < retries){
        const delay = computeDelay(attempt++);
        await new Promise(r=> setTimeout(r, delay));
        continue;
      }
      if(!res.ok){ throw new Error('HTTP '+res.status); }
      if(!expectJson) return res;
      const text = await res.text();
      if(!text) return {};
      try { return JSON.parse(text); } catch { throw new Error('Bad JSON'); }
    } catch(e){
      lastErr = e;
      if(attempt < retries){
        const delay = computeDelay(attempt++);
        await new Promise(r=> setTimeout(r, delay));
        continue;
      }
      throw lastErr;
    }
  }
}
