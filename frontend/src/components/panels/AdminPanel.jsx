import React, { useState, useEffect, useMemo } from 'react';
import { BarSeries, MiniDonut } from './charts/ChartsPrimitives.jsx';

export default function AdminPanel({ token }){
  const [sys,setSys] = useState(null);
  const [error,setError] = useState('');
  const [users,setUsers] = useState([]);
  const [techs,setTechs] = useState([]);
  const [me,setMe] = useState(null);
  const [metricsData,setMetricsData] = useState(null);
  const [metricsErr,setMetricsErr] = useState('');
  useEffect(()=>{ if(token){ fetch('http://localhost:4000/api/auth/me',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(setMe); } },[token]);
  useEffect(()=>{ if(!token) return; (async()=>{ try { const r = await fetch('http://localhost:4000/api/admin/system',{ headers:{ Authorization:'Bearer '+token }}); const d= await r.json(); if(r.ok) setSys(d); else setError(d.error||'system error'); } catch(e){ setError(e.message);} })(); },[token]);
  useEffect(()=>{ if(token) fetch('http://localhost:4000/api/admin/users',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(d=>setUsers(d.users||[])); },[token]);
  useEffect(()=>{ if(token) fetch('http://localhost:4000/api/techniques?all=1',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(d=>setTechs(d.techniques||[])); },[token]);
  useEffect(()=>{ if(token) (async()=>{ try { const r= await fetch('http://localhost:4000/api/metrics',{ headers:{ Authorization:'Bearer '+token }}); const d= await r.json(); if(!r.ok) throw new Error(d.error||'metrics failed'); setMetricsData(d); } catch(e){ setMetricsErr(e.message); } })(); },[token]);
  if(!me) return <div className="card"><h3 style={{marginTop:0}}>Admin</h3><div style={{fontSize:'.65rem', color:'var(--text-dim)'}}>Loading...</div></div>;
  if(me.role!=='admin') return <div className="card"><h3 style={{marginTop:0}}>Admin</h3><div style={{color:'var(--danger)', fontSize:'.7rem'}}>Access denied.</div></div>;

  let metricsSection = null;
  if(metricsData){
    const tiles = [
      { label:'Users', value: metricsData.users },
      { label:'Techniques (pub)', value: metricsData.techniques },
      ...(metricsData.techniques_all? [{ label:'Techniques (all)', value: metricsData.techniques_all }]:[]),
      { label:'Logins', value: metricsData.metrics.logins },
      { label:'HIBP Queries', value: metricsData.metrics.hibpQueries },
      { label:'CVE Searches', value: metricsData.metrics.cveSearches },
      { label:'Terminal Cmds', value: metricsData.metrics.terminalCommands }
    ];
    metricsSection = <>
      <div className="tiles">{tiles.map(t=> <div key={t.label} className="tile"><div className="tile-value">{t.value}</div><div className="tile-label">{t.label}</div></div>)}</div>
      <div className="charts-row">
        <div className="card" style={{flex:1}}>
          <h3 style={{marginTop:0}}>Activity (12h)</h3>
          <BarSeries data={metricsData.series||[]} />
        </div>
        <div className="card" style={{flex:'0 0 300px'}}>
          <h3 style={{marginTop:0}}>Last 24h Types</h3>
          <MiniDonut counts={metricsData.last24||{}} />
        </div>
      </div>
      <div className="card" style={{gridColumn:'1 / -1'}}>
        <h3 style={{marginTop:0}}>Recent Activity</h3>
        <div className="table-scroll" style={{maxHeight:240}}>
          <table><thead><tr><th>Time</th><th>User</th><th>Type</th><th>Meta</th></tr></thead><tbody>
            {(metricsData.recent||[]).map((r,i)=><tr key={i}><td>{new Date(r.ts).toLocaleTimeString()}</td><td>{r.user}</td><td>{r.type}</td><td><code style={{fontSize:'.6rem'}}>{JSON.stringify(r.meta)}</code></td></tr>)}
          </tbody></table>
        </div>
      </div>
    </>;
  } else if(metricsErr){
    metricsSection = <div className="card"><h3 style={{marginTop:0}}>Metrics</h3><div style={{color:'var(--danger)', fontSize:'.65rem'}}>{metricsErr}</div></div>;
  } else {
    metricsSection = <div className="card"><h3 style={{marginTop:0}}>Metrics</h3><div style={{fontSize:'.65rem', color:'var(--text-dim)'}}>Loading...</div></div>;
  }
  return <div className="admin-grid fade-in">
    {metricsSection}
    <div className="card">
      <h3 style={{marginTop:0}}>System</h3>
      {error && <div style={{color:'var(--danger)', fontSize:'.65rem'}}>{error}</div>}
      {sys && <div className="kv"><div><label>HIBP Rate</label><span>{sys.hibp.perMinute}/min</span></div><div><label>HIBP Batch</label><span>{sys.hibp.batchLimit}</span></div><div><label>CVE Cache</label><span>{sys.cache.cveSize}</span></div><div><label>Node</label><span>{sys.versions.node}</span></div><div><label>Uptime</label><span>{Math.round(sys.uptime)}s</span></div></div>}
    </div>
    <div className="card">
      <h3 style={{marginTop:0}}>Users</h3>
      <div className="table-scroll" style={{maxHeight:220}}>
        <table><thead><tr><th>Email</th><th>Role</th><th>Created</th></tr></thead><tbody>{users.map(u=> <tr key={u.id}><td>{u.email}</td><td>{u.role}</td><td>{new Date(u.created_at).toLocaleDateString()}</td></tr>)}</tbody></table>
      </div>
    </div>
    <div className="card" style={{gridColumn:'1 / -1'}}>
      <h3 style={{marginTop:0}}>Techniques (All)</h3>
      <div className="table-scroll" style={{maxHeight:260}}>
        <table><thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Category</th></tr></thead><tbody>{techs.map(t=> <tr key={t.id}><td>{t.id.slice(0,12)}</td><td>{t.name}</td><td>{t.status}</td><td>{t.category}</td></tr>)}</tbody></table>
      </div>
    </div>
  </div>;
}
