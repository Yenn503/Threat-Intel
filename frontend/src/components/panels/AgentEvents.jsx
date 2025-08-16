import React, { useEffect, useRef, useState, useMemo } from 'react';
// DEPRECATION NOTICE: AgentEvents is superseded by UnifiedAIAgent integrated events view.
// Will be removed after migration; avoid adding new logic here.
import { getRecentAgentEvents, getMetricsSnapshots } from '../../api/agent';
import usePolling from '../../hooks/usePolling';

export default function AgentEvents({ token, active }){
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [follow, setFollow] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const wsRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(()=>{ if(!active||!token) return; let cancelled=false; (async()=>{ const res = await getRecentAgentEvents(token); if(!cancelled && res.ok && res.data?.ok && Array.isArray(res.data.events)){ setEvents(res.data.events.map(ev=> ({ ts: ev.ts||Date.now(), type: ev.type||'event', event: ev })) ); }
    const snap = await getMetricsSnapshots(token); if(!cancelled && snap.ok && snap.data?.ok && Array.isArray(snap.data.snapshots)){ setSnapshots(snap.data.snapshots.slice(-50)); }
  })(); return ()=>{ cancelled=true; }; },[active, token]);

  useEffect(()=>{ if(!active||!token) return; if(wsRef.current) return; let attempt=0; let closed=false; const connect=()=>{ if(closed) return; const ws = new WebSocket(`ws://localhost:4000/ws/agent-events?token=${token}`); wsRef.current=ws; let reconnectScheduled=false; const scheduleReconnect=()=>{ if(closed||reconnectScheduled) return; reconnectScheduled=true; attempt++; const backoff=Math.min(30000, 1000 * Math.pow(2, attempt)); setTimeout(()=>{ wsRef.current=null; connect(); }, backoff); };
    ws.onopen=()=>{ setConnected(true); attempt=0; };
    ws.onclose=()=>{ setConnected(false); scheduleReconnect(); };
    ws.onerror=()=>{ try { ws.close(); } catch{} };
    ws.onmessage = ev=> { try { const msg = JSON.parse(ev.data); if(msg.type==='hello'){ if(msg.metrics) setMetrics(msg.metrics); } else if(msg.type==='event'){ setEvents(prev=> { const next=[...prev,{ ts: msg.ts||Date.now(), type: msg.event?.type||'event', event: msg.event }]; return next.slice(-500); }); } } catch{} };
  }; connect(); return ()=> { closed=true; try { wsRef.current?.close(); } catch{} wsRef.current=null; }; },[active, token]);
  // Poll snapshots every 30s using usePolling (activity flag not needed here)
  usePolling(async ()=>{
    if(!active||!token) return false; const res = await getMetricsSnapshots(token); if(res.ok && res.data?.ok && Array.isArray(res.data.snapshots)) setSnapshots(res.data.snapshots.slice(-50)); return false; // false => idle interval
  }, { active: active && !!token, interval:30000, activeInterval:15000 });

  useEffect(()=>{ if(follow && active){ scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); } },[events, follow, active]);

  const visibleEvents = useMemo(()=> events.filter(e=> (!filterType || e.type===filterType) && (!search || JSON.stringify(e.event).toLowerCase().includes(search.toLowerCase())) ), [events, filterType, search]);
  const distinctTypes = useMemo(()=> Array.from(new Set(events.map(e=> e.type))).sort(), [events]);
  const formatTs = t=> { try { return new Date(t).toLocaleTimeString(); } catch { return t; } };

  return (
    <div style={{ display: active? 'flex':'none', flexDirection:'column', gap:16 }}>
      <div className="card" style={{ padding:16, display:'flex', flexDirection:'column', height:420 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontSize:'.7rem', fontWeight:600 }}>Agent Events Stream {connected? <span style={{ color:'#5fbf60' }}>●</span>: <span style={{ color:'#bf5f5f' }}>●</span>}</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <label style={{ fontSize:'.55rem', display:'flex', gap:4, alignItems:'center' }}><input type="checkbox" checked={follow} onChange={e=> setFollow(e.target.checked)} /> Follow</label>
            <select value={filterType} onChange={e=> setFilterType(e.target.value)} style={{ fontSize:'.55rem' }}>
              <option value="">All Types</option>
              {distinctTypes.map(t=> <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search" style={{ fontSize:'.55rem', padding:'4px 6px', width:120 }} />
          </div>
        </div>
        <div ref={scrollRef} className="table-scroll" style={{ flex:1, overflow:'auto', fontSize:'.55rem', lineHeight:1.3, background:'#0f1820', border:'1px solid #14212e', borderRadius:8, padding:6 }}>
          {visibleEvents.map((e,i)=> (
            <div key={i} style={{ padding:'2px 4px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', gap:6 }}>
              <span style={{ opacity:.6, minWidth:68 }}>{formatTs(e.ts)}</span>
              <span style={{ color:'#58a6ff', minWidth:120 }}>{e.type}</span>
              <span style={{ whiteSpace:'pre-wrap', flex:1, fontFamily:'var(--font-mono)', overflowWrap:'anywhere' }}>{JSON.stringify(e.event)}</span>
            </div>
          ))}
          {!visibleEvents.length && <div style={{ opacity:.5 }}>No events.</div>}
        </div>
        <div style={{ marginTop:8, fontSize:'.5rem', opacity:.6 }}>Showing {visibleEvents.length} / {events.length} events.</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div className="card" style={{ padding:16 }}>
          <div style={{ fontSize:'.65rem', fontWeight:600, marginBottom:6 }}>Current Metrics</div>
          {metrics ? (
            <ul style={{ margin:0, paddingLeft:16, fontSize:'.55rem', lineHeight:1.4 }}>
              {Object.entries(metrics).map(([k,v])=> <li key={k}><code>{k}</code>: {String(v)}</li>)}
            </ul>
          ) : <div style={{ fontSize:'.55rem', opacity:.6 }}>Awaiting snapshot…</div>}
        </div>
        <div className="card" style={{ padding:16 }}>
          <div style={{ fontSize:'.65rem', fontWeight:600, marginBottom:6 }}>Recent Metric Snapshots</div>
          <div className="table-scroll" style={{ maxHeight:180 }}>
            <table style={{ fontSize:'.5rem', width:'100%' }}>
              <thead><tr><th style={{ textAlign:'left' }}>Time</th><th style={{ textAlign:'left' }}>Tasks</th><th>Plans</th><th>Success%</th></tr></thead>
              <tbody>
                {snapshots.slice().reverse().map(s=> <tr key={s.ts}><td>{formatTs(s.ts)}</td><td>{s.totalTasks??'-'}</td><td>{s.totalPlans??'-'}</td><td>{s.successRate??'-'}</td></tr>)}
                {!snapshots.length && <tr><td colSpan={4} style={{ opacity:.5 }}>None</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
