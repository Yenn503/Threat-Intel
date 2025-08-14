import React, { useState, useEffect } from 'react';

export default function Dashboard({ token, setActive, consoleState }){
  const [me,setMe] = useState(null);
  const [metrics,setMetrics] = useState(null);
  const [loading,setLoading] = useState(true);
  const [err,setErr] = useState('');
  useEffect(()=>{ if(token){ fetch('http://localhost:4000/api/auth/me',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(setMe).catch(()=>{}); fetch('http://localhost:4000/api/metrics',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(d=>{ setMetrics(d); setLoading(false); }).catch(e=>{ setErr(e.message); setLoading(false); }); } },[token]);
  const quick = [
    { label:'Techniques', action:()=>setActive('Exploits'), desc:'Browse & edit exploit techniques' },
    { label:'Terminal', action:()=>setActive('Console'), desc:'Interactive shell session' },
    { label:'CVE Search', action:()=>setActive('Vuln Search'), desc:'Query latest vulnerabilities' },
    { label:'HIBP Lookup', action:()=>setActive('DB Search'), desc:'Breach exposure checking' },
    { label:'Code Editor', action:()=>setActive('Code Editor'), desc:'Draft & refine exploit code' },
    { label:'Admin', action:()=>setActive('Admin'), desc:'System metrics & management', admin:true },
  ];
  const lastConsole = (consoleState?.buffer||'').split(/\n/).slice(-6).join('\n');
  const activity = metrics?.recent?.slice(0,8) || [];
  const tiles = metrics ? [
    { k:'Techniques', v: metrics.techniques + (metrics.techniques_all? '/' + metrics.techniques_all:'') },
    { k:'Users', v: metrics.users },
    { k:'Logins', v: metrics.metrics.logins },
    { k:'Queries', v: metrics.metrics.hibpQueries + ' HIBP' },
    { k:'CVE', v: metrics.metrics.cveSearches },
    { k:'Terminal', v: metrics.metrics.terminalCommands }
  ]: [];
  return <div className="dashboard-shell fade-in">
    <div className="hero">
      <div className="hero-left">
        <h1 className="hero-title">Operator Hub</h1>
        <p className="hero-sub">Welcome {me?.email?.split('@')[0]||'operator'} — maintain tempo & visibility.</p>
        <div className="hero-meta-row">
          {tiles.slice(0,4).map(t=> <div key={t.k} className="mini-stat"><span>{t.v}</span><label>{t.k}</label></div>)}
        </div>
      </div>
      <div className="hero-right console-teaser">
        <div className="teaser-head">Last Console Output</div>
        <pre className="teaser-pre">{lastConsole || '— no output yet —'}</pre>
        <button className="btn small overlay" onClick={()=>setActive('Console')}>Open Terminal</button>
      </div>
    </div>
    <div className="quick-actions-card card-glass">
      <h3>Quick Access</h3>
      <div className="quick-grid">{quick.filter(q=>!q.admin || me?.role==='admin').map(q=> <button key={q.label} className="quick-tile" onClick={q.action}><div className="q-label">{q.label}</div><div className="q-desc">{q.desc}</div></button>)}</div>
    </div>
    <div className="lower-grid">
      <div className="card panel activity">
        <h3 style={{marginTop:0}}>Recent Activity</h3>
        {loading && <div className="skeleton-line" style={{width:'60%'}}></div>}
        {!loading && !activity.length && <div className="empty-note">No recent events.</div>}
        <ul className="activity-list">{activity.map((a,i)=> <li key={i}><span className="time">{new Date(a.ts).toLocaleTimeString()}</span><span className="type">{a.type}</span><span className="who">{a.user}</span><code className="meta">{JSON.stringify(a.meta)}</code></li>)}</ul>
      </div>
      <div className="card panel stats">
        <h3 style={{marginTop:0}}>Status</h3>
        <div className="status-tiles">{tiles.map(t=> <div className="stat" key={t.k}><div className="stat-val">{t.v}</div><div className="stat-label">{t.k}</div></div>)}</div>
        {err && <div className="form-error" style={{marginTop:8}}>{err}</div>}
      </div>
    </div>
  </div>;
}
