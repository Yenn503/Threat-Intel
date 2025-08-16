import React, { useEffect, useRef, useState, useMemo } from 'react';
import './agentPanel.css';
import LoopToggle from './LoopToggle.jsx';

function useAgentHeartbeat(token){
  const [data,setData] = useState({ agents:[], queue:[], loop:{}, events:[], ts: Date.now() });
  const wsRef = useRef(null);
  useEffect(()=>{
    if(!token) return;
    const url = `${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/agent/ws?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
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
    ws.onclose = ()=>{ wsRef.current=null; };
    return ()=> ws.close();
  },[token]);
  return data;
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

export default function AgentPanel({ token }){
  const hb = useAgentHeartbeat(token);
  return (
    <div className="agent-panel">
      <div className="panel-header">
        <h2>Agent Monitor</h2>
        <LoopToggle token={token} loop={hb.loop} onChange={()=>{/* loop state will refresh via heartbeat */}} />
        <div className="loop-state">Loop: {hb.loop.running? 'running':'idle'} {hb.loop.paused && <span className="badge" style={{background:'#b91c1c'}}>paused</span>} {hb.loop.deterministic && <span className="badge">deterministic</span>} <span className="interval">{hb.loop.intervalMs}ms</span></div>
        <div className="timestamp">Updated {new Date(hb.ts).toLocaleTimeString()}</div>
      </div>
      <AgentStatusGrid agents={hb.agents} />
      <h3>Queue</h3>
      <QueueView queue={hb.queue} />
      <h3 style={{marginTop:'1rem'}}>Recent Agent Events</h3>
      <div className="events-list">
        {hb.events && hb.events.slice().reverse().map(e=> (
          <div key={e.id||e.ts} className={"evt type-"+e.type}>
            <span className="ts">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="label">{e.type}</span>
            {e.agent && <span className="agent">{e.agent}</span>}
            {e.tool && <span className="tool">{e.tool}</span>}
            {e.prevStatus && e.nextStatus && <span className="status-change">{e.prevStatus}→{e.nextStatus}</span>}
            {e.error && <span className="error" title={e.error}>{e.error}</span>}
          </div>
        ))}
        {(!hb.events || !hb.events.length) && <div className="empty" style={{padding:'0.5rem'}}>No events yet.</div>}
      </div>
    </div>
  );
}
