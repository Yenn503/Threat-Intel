import React, { useEffect, useRef, useState, useMemo } from 'react';
import { apiFetch, wsUrl, waitForBackendPort } from '../../../lib/apiClient.js';
import './agentPanel.css';
import LoopToggle from './LoopToggle.jsx';

function useAgentHeartbeat(token){
  const [data,setData] = useState({ agents:[], queue:[], loop:{}, events:[], ts: Date.now(), fallback:false });
  const wsRef = useRef(null);
  const [filters,setFilters] = useState({ type:'all', windowMin:0 });
  const reconnectRef = useRef({ attempts:0, timer:null, manual:false });
  const pollRef = useRef({ active:false, timer:null });
  useEffect(()=>{
    if(!token) return;
    let stopped = false;
  async function connect(){
      if(stopped) return;
    await waitForBackendPort();
  const url = wsUrl(`/api/agent/ws?token=${token}`);
    try { console.log('[AgentPanel] connecting', url); } catch{}
      const ws = new WebSocket(url);
      wsRef.current = ws;
      let opened=false;
      ws.onopen = ()=>{ opened=true; reconnectRef.current.attempts=0; };
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if(msg.type==='heartbeat'){
            setData({ agents: msg.agents||[], queue: msg.queue||[], loop: msg.loop||{}, events: msg.events||[], ts: msg.ts });
          } else if(msg.type==='hello') {
            setData(d=> ({ ...d, loop: msg.loop||d.loop }));
          }
        } catch {}
      };
  ws.onclose = ()=>{
        wsRef.current=null;
        if(stopped) return;
        const attempt = ++reconnectRef.current.attempts;
        const delay = Math.min(30000, Math.pow(2, attempt) * 250); // exponential backoff capped at 30s
        reconnectRef.current.timer = setTimeout(connect, delay);
        if(attempt>=3 && !pollRef.current.active){
          pollRef.current.active = true;
          const poll = async()=>{
            if(stopped) return;
            try {
              const s = await apiFetch('/api/agent/status',{ headers:{ Authorization:'Bearer '+token }});
      if(s.ok){ const js = await s.json(); setData(d=> ({ ...d, agents: js.agents||[], loop: js.loop||d.loop, ts: js.ts||Date.now(), fallback:true })); }
              const q = await apiFetch('/api/agent/queue',{ headers:{ Authorization:'Bearer '+token }});
      if(q.ok){ const jq = await q.json(); setData(d=> ({ ...d, queue: jq.queue||[], ts: jq.ts||Date.now(), fallback:true })); }
            } catch{}
            pollRef.current.timer = setTimeout(poll, 4000);
          };
          poll();
        }
      };
      ws.onerror = ()=>{ try { ws.close(); } catch{} };
    }
    connect();
    return ()=>{ stopped=true; if(wsRef.current) try { wsRef.current.close(); } catch{}; if(reconnectRef.current.timer) clearTimeout(reconnectRef.current.timer); if(pollRef.current.timer) clearTimeout(pollRef.current.timer); };
  },[token]);
  return { ...data, filters, setFilters };
}

function AgentStatusGrid({ agents }){
  const prevRef = useRef({});
  const [flashes,setFlashes] = useState({});
  useEffect(()=>{
    const prev = prevRef.value || prevRef.current;
    const nextFlashes = {};
    for(const a of agents){
      const p = prev[a.agent];
      if(p && (p.status!==a.status || p.target!==a.target)){
        nextFlashes[a.agent] = Date.now();
      } else if(!p && a.status!=='idle'){
        nextFlashes[a.agent] = Date.now();
      }
    }
    if(Object.keys(nextFlashes).length){
      setFlashes(f=> ({...f, ...nextFlashes}));
    }
    prevRef.current = Object.fromEntries(agents.map(a=> [a.agent,{ status:a.status, target:a.target }]));
  },[agents]);
  useEffect(()=>{
    const t = setInterval(()=>{
      const now = Date.now();
      let changed=false; const copy={...flashes};
      for(const k of Object.keys(copy)) if(now - copy[k] > 1200){ delete copy[k]; changed=true; }
      if(changed) setFlashes(copy);
    },300);
    return ()=> clearInterval(t);
  },[flashes]);
  return (
    <div className="agent-grid">
      {agents.map(a=> {
        const flash = flashes[a.agent];
        return (
          <div key={a.agent} className={`agent-card status-${a.status} ${flash? 'flash':''}`}>
            <div className="agent-name">{a.agent}</div>
            <div className="agent-status">{a.status}</div>
            {a.target && <div className="agent-target" title={a.target}>{a.target}</div>}
            {a.lastRunIso && <div className="agent-last">last: {a.lastRunIso.split('T')[1].slice(0,8)}</div>}
          </div>
        );
      })}
      {!agents.length && <div className="empty">No agent activity yet.</div>}
    </div>
  );
}

function QueueView({ queue }){
  return (
    <table className="queue-table">
      <thead><tr><th>ID</th><th>Status</th><th>Pending</th><th>Running</th><th>Total</th><th>ETA(s)</th></tr></thead>
      <tbody>
        {queue.map(q=> (
          <tr key={q.id}>
            <td title={q.id}>{q.id.slice(0,8)}</td>
            <td>{q.status}</td>
            <td>{q.pending}</td>
            <td>{q.running}</td>
            <td>{q.total}</td>
            <td>{q.etaSec}</td>
          </tr>
        ))}
        {!queue.length && <tr><td colSpan={6} style={{textAlign:'center', opacity:0.6}}>Queue empty</td></tr>}
      </tbody>
    </table>
  );
}

function DrillDown({ token, target }){
  const [open, setOpen] = useState(false);
  const [loading,setLoading] = useState(false);
  const [enrichment,setEnrichment] = useState(null);
  const [validation,setValidation] = useState(null);
  async function load(){
    if(!target) return;
    setLoading(true);
    try {
      // fetch latest completed nmap scan for target to get scanId
      const rScan = await fetch(`/api/scans?target=${encodeURIComponent(target)}&limit=1&type=nmap`, { headers:{ Authorization:'Bearer '+token }});
      let scanId=null;
      if(rScan.ok){ const js = await rScan.json(); scanId = js.scans?.[0]?.id; }
      if(scanId){
        const rEn = await fetch(`/api/scan/enrichment/${scanId}`, { headers:{ Authorization:'Bearer '+token }});
        if(rEn.ok){ const js = await rEn.json(); setEnrichment(js.enrichment); }
      }
      const rVal = await fetch(`/api/validation/stats/${encodeURIComponent(target)}`, { headers:{ Authorization:'Bearer '+token }});
      if(rVal.ok){ const js = await rVal.json(); setValidation(js.stats); }
    } catch{}
    setLoading(false);
  }
  useEffect(()=>{ if(open && enrichment==null && !loading) load(); },[open]);
  if(!target) return null;
  return <div className="drilldown">
    <button className="btn tiny" onClick={()=> setOpen(o=> !o)}>{open? 'Hide':'Details'}</button>
    {open && <div className="drill-body">
      {loading && <div className="mini">Loading…</div>}
      {!loading && <>
        <div className="mini-section">
          <div className="mini-title">Enrichment</div>
          {enrichment? <div className="mini-json">{enrichment.openPorts?.length? enrichment.openPorts.slice(0,10).map(p=> `${p.port}/${p.service}`).join(', '): 'No ports'}</div> : <div className="mini-json empty">No enrichment</div>}
        </div>
        <div className="mini-section">
          <div className="mini-title">Validation</div>
          {validation? <div className="mini-json">{validation.validated}/{validation.total} valid</div> : <div className="mini-json empty">No stats</div>}
        </div>
      </>}
    </div>}
  </div>;
}

export default function AgentPanel({ token }){
  const hb = useAgentHeartbeat(token);
  const activeTarget = useMemo(()=> hb.agents.find(a=> a.status==='running' && a.target)?.target || null, [hb.agents]);
  const filteredEvents = useMemo(()=> {
    let ev = hb.events||[];
    if(hb.filters.type !== 'all') ev = ev.filter(e=> e.type===hb.filters.type);
    if(hb.filters.windowMin){ const cutoff = Date.now() - hb.filters.windowMin*60*1000; ev = ev.filter(e=> e.ts >= cutoff); }
    return ev;
  },[hb.events, hb.filters]);
  async function manual(op){
    try {
  const body = op==='step'? JSON.stringify({ taskId: (hb.queue[0]?.id) }) : undefined;
  await apiFetch(`/api/agent/op/${op}`, { method:'POST', headers:{ Authorization:'Bearer '+token, ...(body? { 'Content-Type':'application/json'}:{} ) }, body });
    } catch{}
  }
  const [cfg,setCfg] = useState(null);
  useEffect(()=>{ (async()=>{ try { const r= await apiFetch(`/api/agent/config`,{ headers:{ Authorization:'Bearer '+token }}); if(r.ok){ const j=await r.json(); setCfg(j.config); } } catch{} })(); },[token]);
  async function toggleDiff(){
    try {
  const r = await apiFetch(`/api/agent/config`, { method:'PATCH', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+token }, body: JSON.stringify({ diffBasedNuclei: !cfg?.diffBasedNuclei }) });
      if(r.ok){ const j=await r.json(); setCfg(j.config); }
    } catch{}
  }
  return (
    <div className="agent-panel">
      <div className="panel-header">
        <h2>Agent Monitor</h2>
        <LoopToggle token={token} loop={hb.loop} onChange={()=>{/* loop state will refresh via heartbeat */}} />
        <div className="loop-state">Loop: {hb.loop.running? 'running':'idle'} {hb.loop.paused && <span className="badge" style={{background:'#b91c1c'}}>paused</span>} {hb.loop.deterministic && <span className="badge">deterministic</span>} <span className="interval">{hb.loop.intervalMs}ms</span></div>
  <div className="timestamp">Updated {new Date(hb.ts).toLocaleTimeString()} {hb.fallback && <span className="badge" style={{background:'#92400e'}}>fallback</span>}</div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
        {activeTarget && <div className="active-target">Active: <strong>{activeTarget}</strong></div>}
        <DrillDown token={token} target={activeTarget} />
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6}}>
          <label style={{display:'flex',alignItems:'center',gap:4,fontSize:10}} title="Only auto-queue nuclei when new ports appear in Nmap vs previous scan.">
            <input type="checkbox" checked={!!cfg?.diffBasedNuclei} onChange={toggleDiff} /> diff-based nuclei
          </label>
        </div>
      </div>
      <AgentStatusGrid agents={hb.agents} />
      <h3>Queue</h3>
      <QueueView queue={hb.queue} />
      <h3 style={{marginTop:'1rem', display:'flex',alignItems:'center',gap:8}}>Recent Agent Events
        <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
          <label style={{display:'flex',alignItems:'center',gap:4,fontSize:10}}>Type
            <select value={hb.filters.type} onChange={e=> hb.setFilters(f=> ({...f, type:e.target.value}))} style={{fontSize:10}}>
              <option value="all">all</option>
              <option value="error">error</option>
              <option value="task_complete">task_complete</option>
              <option value="step_done">step_done</option>
            </select>
          </label>
          <label style={{display:'flex',alignItems:'center',gap:4,fontSize:10}}>Window
            <select value={hb.filters.windowMin} onChange={e=> hb.setFilters(f=> ({...f, windowMin: parseInt(e.target.value,10)}))} style={{fontSize:10}}>
              <option value={0}>all</option>
              <option value={5}>5m</option>
              <option value={15}>15m</option>
              <option value={60}>1h</option>
            </select>
          </label>
          <div className="manual-btns">
            <button className="btn tiny" onClick={()=> manual('step')}>Step</button>
            <button className="btn tiny" onClick={()=> manual('flush')}>Flush</button>
          </div>
        </div>
      </h3>
      <div className="events-list">
        {filteredEvents && filteredEvents.slice().reverse().map(e=> (
          <div key={e.id||e.ts} className={"evt type-"+e.type}>
            <span className="ts">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="label">{e.type}</span>
            {e.agent && <span className="agent">{e.agent}</span>}
            {e.tool && <span className="tool">{e.tool}</span>}
            {e.prevStatus && e.nextStatus && <span className="status-change">{e.prevStatus}→{e.nextStatus}</span>}
            {e.error && <span className="error" title={e.error}>{e.error}</span>}
          </div>
        ))}
  {(!filteredEvents || !filteredEvents.length) && <div className="empty" style={{padding:'0.5rem'}}>No events.</div>}
      </div>
    </div>
  );
}
