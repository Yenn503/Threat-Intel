import React, { useEffect, useRef, useState, useCallback, createContext, useContext, useMemo } from 'react';
import { FiHome, FiCpu, FiTerminal, FiCode, FiDatabase, FiShield, FiSettings, FiPlus, FiEdit2, FiTrash2, FiSave, FiX, FiGlobe } from 'react-icons/fi';
import { createRoot } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import arfData from './osint-arf.json';

class PanelErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state={ error:null }; }
  static getDerivedStateFromError(e){ return { error:e }; }
  componentDidCatch(e, info){ console.error('Panel error', e, info); }
  render(){ if(this.state.error){ return <div className="card" style={{padding:24}}><h3 style={{marginTop:0}}>Panel Error</h3><div style={{fontSize:'.7rem', color:'var(--danger)'}}>{String(this.state.error && this.state.error.message || this.state.error)}</div><button className="btn" style={{marginTop:12}} onClick={()=> this.setState({error:null})}>Retry Mount</button></div>; } return this.props.children; }
}
// Configure Monaco workers (silences fallback warning in browsers bundling via Vite)
// This leverages dynamic worker URLs so each language gets its proper worker.
// If the bundler doesn't support import.meta.url with monaco-editor ESM, adjust build config accordingly.
if(typeof self !== 'undefined' && !self.MonacoEnvironment){
  self.MonacoEnvironment = {
    getWorker(_, label){
      try {
        if(label === 'json') return new Worker(new URL('monaco-editor/esm/vs/language/json/json.worker', import.meta.url), { type:'module' });
        if(label === 'css' || label === 'scss' || label === 'less') return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker', import.meta.url), { type:'module' });
        if(label === 'html' || label === 'handlebars' || label === 'razor') return new Worker(new URL('monaco-editor/esm/vs/language/html/html.worker', import.meta.url), { type:'module' });
        if(label === 'typescript' || label === 'javascript') return new Worker(new URL('monaco-editor/esm/vs/language/typescript/ts.worker', import.meta.url), { type:'module' });
        return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url), { type:'module' });
      } catch(e){
        console.warn('Monaco worker load failed, continuing without web workers', e);
        return { terminate(){}, postMessage(){} };
      }
    }
  };
}

const panels = [ 'Dashboard','Exploits','OSINT','Console','Code Editor','DB Search','Vuln Search','FSWA','Admin','Settings' ];
const panelIcons = {
  'Dashboard': <FiHome size={14}/>,'Exploits': <FiCpu size={14}/>,'OSINT': <FiGlobe size={14}/>,'Console': <FiTerminal size={14}/>,'Code Editor': <FiCode size={14}/>,'DB Search': <FiDatabase size={14}/>,'Vuln Search': <FiShield size={14}/>,'FSWA': <FiShield size={14}/>,'Admin': <FiSettings size={14}/>,'Settings': <FiSettings size={14}/>
};

function App(){
  const [active, setActive] = useState(()=> localStorage.getItem('ti_active_panel') || 'Dashboard');
  const [token, setToken] = useState(null);
  const [techniquesMeta,setTechniquesMeta] = useState([]); // minimal list for palette search
  const [theme,setTheme] = useState(()=> {
    const stored = localStorage.getItem('ti_theme');
    if(stored) return stored;
    const prefers = window.matchMedia('(prefers-color-scheme: light)').matches? 'light':'dark';
    return prefers;
  });
  useEffect(()=>{ document.documentElement.classList.toggle('light', theme==='light'); localStorage.setItem('ti_theme', theme); },[theme]);
  // Watch system theme changes (if user hasn't explicitly chosen) – only when no explicit stored value
  useEffect(()=>{
    if(localStorage.getItem('ti_theme')) return; // user override
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = e => setTheme(e.matches? 'light':'dark');
    mq.addEventListener('change', handler);
    return ()=> mq.removeEventListener('change', handler);
  },[]);
  // Persist panel selection
  useEffect(()=>{ localStorage.setItem('ti_active_panel', active); },[active]);
  // Hotkey: Ctrl+Shift+T toggles theme
  useEffect(()=>{
    function onKey(e){ if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='t'){ setTheme(t=> t==='dark'?'light':'dark'); e.preventDefault(); } }
    window.addEventListener('keydown', onKey); return ()=> window.removeEventListener('keydown', onKey);
  },[]);
  const [consoleState, setConsoleState] = useState({ buffer:'', inputLine:'' });
  const [commandOpen,setCommandOpen] = useState(false);
  const [commandQuery,setCommandQuery] = useState('');
  useEffect(()=>{ function onKey(e){ if(e.ctrlKey && !e.shiftKey && e.key.toLowerCase()==='k'){ e.preventDefault(); setCommandOpen(o=>!o); setCommandQuery(''); } } window.addEventListener('keydown',onKey); return ()=> window.removeEventListener('keydown',onKey); },[]);
  const commandItems = [
    ...panels.map(p=> ({ group:'Panels', label:p, action:()=> setActive(p) })),
    { group:'Theme', label:'Toggle Theme', action:()=> setTheme(t=> t==='dark'?'light':'dark') },
    { group:'Actions', label:'Open Console', action:()=> setActive('Console') },
    { group:'Actions', label:'New Technique', action:()=> setActive('Exploits') }
  ,
    // Dynamic techniques (quick open)
    ...techniquesMeta.map(t=> ({ group:'Techniques', label:`${t.category}: ${t.name}`, action:()=> { localStorage.setItem('ti_select_tech_id', String(t.id)); setActive('Exploits'); } })),
    // Editor files (read from localStorage snapshot)
    ...(()=>{ try { const fs = JSON.parse(localStorage.getItem('ti_editor_files'))||[]; return fs.map(f=> ({ group:'Files', label:'Open File: '+f.name, action:()=> { localStorage.setItem('ti_editor_active', f.id); setActive('Code Editor'); } })); } catch { return []; } })()
  ];
  const filteredCommands = commandItems.filter(c=> c.label.toLowerCase().includes(commandQuery.toLowerCase()));
  const wsRef = useRef(null);
  const [consoleConnected, setConsoleConnected] = useState(false);
  // Removed persistence of console buffer for security/privacy.

  // Fetch techniques meta for palette (debounced on token change)
  useEffect(()=>{ if(!token) { setTechniquesMeta([]); return; } fetch('http://localhost:4000/api/techniques').then(r=>r.json()).then(d=> setTechniquesMeta(d.techniques||[])).catch(()=>{}); },[token]);

  // Panel cycling hotkeys (Ctrl+Alt+ArrowLeft/Right)
  useEffect(()=>{ function key(e){ if(e.ctrlKey && e.altKey && (e.key==='ArrowRight' || e.key==='ArrowLeft')){ e.preventDefault(); const idx = panels.indexOf(active); if(idx!==-1){ const next = e.key==='ArrowRight'? (idx+1)%panels.length : (idx-1+panels.length)%panels.length; setActive(panels[next]); } } } window.addEventListener('keydown', key); return ()=> window.removeEventListener('keydown', key); },[active]);

  // Establish single WS session when token available. Do NOT recreate on tab switches.
  useEffect(()=>{
    if(!token) { if(wsRef.current){ wsRef.current.close(); wsRef.current=null; setConsoleConnected(false);} return; }
    if(wsRef.current) return; // already connected
    const ws = new WebSocket(`ws://localhost:4000/api/terminal?token=${token}`);
    wsRef.current = ws;
    ws.onopen = ()=> setConsoleConnected(true);
    ws.onclose = ()=> { setConsoleConnected(false); wsRef.current=null; };
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if(msg.type==='data'){
          const cleaned = filterShellNoise(msg.data);
          if(cleaned){ setConsoleState(s => ({...s, buffer: s.buffer + cleaned })); }
        }
      } catch {}
    };
    return ()=> { ws.close(); };
  },[token, setConsoleState]);

  function sendConsole(data){ if(wsRef.current) wsRef.current.send(JSON.stringify({ type:'stdin', data: data })); }

    function filterShellNoise(chunk){
      // If we've already shown the banner once, strip any further banner fragments or repeating lead-in lines
      if(consoleState.buffer.includes('Windows PowerShell')){
        chunk = chunk
          .replace(/Windows PowerShell\r?\n/gi,'')
          .replace(/Copyright \(C\) Microsoft Corporation\. All rights reserved\.\r?\n/gi,'')
          .replace(/Install the latest PowerShell[^\n]*\n\r?\n?/gi,'')
          .replace(/PS [^>]+> Windows PowerShell/gi, match=> match.replace(/Windows PowerShell/i,''));
      }
      // Collapse duplicate prompts in the incoming chunk if already present at tail
      const promptLineRegex = /^PS [^\n>]+> ?$/;
      const lines = chunk.split(/\r?\n/);
      if(lines.length===1 && promptLineRegex.test(lines[0].trim())){
        const existingLines = consoleState.buffer.split(/\r?\n/);
        let dupCount=0; for(let i=existingLines.length-1;i>=0 && dupCount<5;i--){ if(existingLines[i].trim()===lines[0].trim()) dupCount++; else break; }
        if(dupCount>=1) return ''; // skip adding another identical prompt
      }
      return chunk;
    }

  // Deduplicate already persisted repeated PowerShell prompts on initial mount
  function dedupPSPrompts(text){
    return text.replace(/(?:^|\n)(PS [^\n>]+>)(?:\r?\n\1)+/g, (m,p1,offset)=> (offset===0? '' : '\n')+p1);
  }
  useEffect(()=>{
    setConsoleState(s=>{ const cleaned = dedupPSPrompts(s.buffer); return cleaned===s.buffer? s : {...s, buffer: cleaned }; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout(){
    setToken(null);
    setConsoleState({ buffer:'', inputLine:'' });
  }
  // Clear console when a new token is set (fresh auth session) to avoid showing previous user's commands
  useEffect(()=>{ if(token){ setConsoleState({ buffer:'', inputLine:'' }); } }, [token]);

  return (
  <ToastProvider>
      <div className="sidebar">
        <div className="brand">
          <div className="brand-logo">TI</div>
          <h1>Threat‑Intel</h1>
        </div>
        <div className="nav" style={{display:'flex', flexDirection:'column', height:'100%'}}>
          <div style={{flex:1, display:'flex', flexDirection:'column'}}>
            {/* Primary */}
            <button onClick={()=>setActive('Dashboard')} className={"nav-button "+(active==='Dashboard'?'active':'')}>
              {panelIcons['Dashboard']} <span>Dashboard</span>
            </button>
            <button onClick={()=>setActive('Exploits')} className={"nav-button "+(active==='Exploits'?'active':'')}>
              {panelIcons['Exploits']} <span>Exploits</span>
            </button>
            <button onClick={()=>setActive('OSINT')} className={"nav-button "+(active==='OSINT'?'active':'')}>
              {panelIcons['OSINT']} <span>OSINT</span>
            </button>
            {/* Databases Section */}
            <div className="nav-section-label">Databases</div>
            <button onClick={()=>setActive('DB Search')} className={"nav-button "+(active==='DB Search'?'active':'')}>
              {panelIcons['DB Search']} <span>DB Search</span>
            </button>
            <button onClick={()=>setActive('Vuln Search')} className={"nav-button "+(active==='Vuln Search'?'active':'')}>
              {panelIcons['Vuln Search']} <span>Vuln Search</span>
            </button>
            {/* Tools Section */}
            <div className="nav-section-label">Tools</div>
            <button onClick={()=>setActive('Console')} className={"nav-button "+(active==='Console'?'active':'')}>
              {panelIcons['Console']} <span>Console</span>
            </button>
            <button onClick={()=>setActive('Code Editor')} className={"nav-button "+(active==='Code Editor'?'active':'')}>
              {panelIcons['Code Editor']} <span>Code Editor</span>
            </button>
            {/* Assessments Section */}
            <div className="nav-section-label">Assessments</div>
            <button onClick={()=>setActive('FSWA')} className={"nav-button "+(active==='FSWA'?'active':'')}>
              {panelIcons['FSWA']} <span>FSWA</span>
            </button>
          </div>
          {/* Bottom System Section */}
          <div style={{display:'flex', flexDirection:'column', gap:4, marginTop:8}}>
            <button onClick={()=>setActive('Admin')} className={"nav-button "+(active==='Admin'?'active':'')}>
              {panelIcons['Admin']} <span>Admin</span>
            </button>
            <button onClick={()=>setActive('Settings')} className={"nav-button "+(active==='Settings'?'active':'')}>
              {panelIcons['Settings']} <span>Settings</span>
            </button>
            <div className="nav-footer" style={{marginTop:6}}>v0.3.0 • {token? 'AUTH' : 'GUEST'}</div>
          </div>
        </div>
      </div>
      <div className="content">
        <div className="app-header">
          <h2>{active}</h2>
          <div className={"status-pill "+(token?'online':'')}>{token? 'Logged In' : 'Not Authenticated'}</div>
        </div>
        <main>
          <div className={"center-wrap fade-in" + (active==='FSWA' ? ' wide' : '')}>
            {!token && active !== 'Settings' && <Auth setToken={setToken} />}
            {token && active==='Dashboard' && <Dashboard token={token} setActive={setActive} consoleState={consoleState} />}            
            {token && active==='Exploits' && <ExploitPanel token={token}/>}
            {token && active==='OSINT' && <OSINTPanel token={token} />}
            {/* Keep ConsolePanel mounted always when authenticated to preserve session */}
            {token && <ConsolePanel
              active={active==='Console'}
              consoleState={consoleState}
              setConsoleState={setConsoleState}
              sendConsole={sendConsole}
              connected={consoleConnected}
            />}
            {token && active==='Code Editor' && <PanelErrorBoundary><CodeEditor theme={theme}/></PanelErrorBoundary>}
            {token && <DBSearch token={token} active={active==='DB Search'}/>}          
            {token && active==='FSWA' && <FSWA token={token} />}
            {token && active==='Vuln Search' && <VulnSearch token={token}/>}      
            {active==='Admin' && <AdminPanel token={token} />}
            {active==='Settings' && <Settings token={token} setToken={setToken} logout={logout} theme={theme} setTheme={setTheme} />}
          </div>
        </main>
      </div>
      <Toasts />
  {commandOpen && <CommandPalette query={commandQuery} setQuery={setCommandQuery} close={()=> setCommandOpen(false)} items={filteredCommands} />}
    </ToastProvider>
  );
}

function Auth({ setToken }){
  const [email,setEmail]=useState('admin@example.com');
  const [password,setPassword]=useState('password');
  const [error,setError]=useState('');
  const toast = useToast();
  async function login(){
    setError('');
  try {
      const r = await fetch('http://localhost:4000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
      const data = await r.json();
      if(!r.ok) { setError(data.error||'Login failed'); toast.error(data.error||'Login failed'); return; }
      setToken(data.token);
      toast.success('Welcome back');
    } catch(e){ setError(e.message); toast.error(e.message); }
  }
  return <div className="auth-shell">
    <div className="auth-hero">
      <div className="logo-orb">TI</div>
      <h1>Threat‑Intel Operator Console</h1>
      <p className="tagline">Enumerate. Exploit. Evolve.</p>
      <ul className="feature-bullets">
        <li>Unified exploit technique workspace</li>
        <li>Real‑time terminal session</li>
        <li>Breach & CVE intelligence</li>
      </ul>
    </div>
    <div className="auth-panel pop-in">
      <h2>Sign In</h2>
      <p className="muted">Use the seeded credentials to explore the full surface.</p>
      <div className="form-group">
        <label>Email</label>
        <input autoFocus value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@example.com" />
      </div>
      <div className="form-group">
        <label>Password</label>
        <input value={password} type="password" onChange={e=>setPassword(e.target.value)} placeholder="••••••••" />
      </div>
      <button className="btn accent full" onClick={login}>Enter Console</button>
      {error && <div className="form-error">{error}</div>}
      <div className="legal">Authorized testing only. Activity is logged.</div>
    </div>
  </div>;
}

function Dashboard({ token, setActive, consoleState }){
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

function BarSeries({ data }){
  const max = Math.max(...data.map(d=>d.count),1);
  return <div className="bar-series">{data.map(d=> <div key={d.hour} className="bar-wrap"><div className="bar" style={{height:(d.count/max*100)+'%'}} title={d.count+" events @"+d.hour+":00"}></div><div className="bar-label">{d.hour}</div></div>)}</div>;
}
function MiniDonut({ counts }){
  const entries = Object.entries(counts);
  const total = entries.reduce((a,[,v])=>a+v,0) || 1;
  let acc=0;
  const segs = entries.map(([k,v])=>{ const start=acc/total*100; acc+=v; const end=acc/total*100; return { k,v,start,end }; });
  const colors = ['#3b82f6','#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#14b8a6'];
  return <div className="donut-box">
    <svg viewBox="0 0 42 42" className="donut">
      {segs.map((s,i)=>{ const dash = s.end - s.start; return <circle key={s.k} className="donut-seg" stroke={colors[i%colors.length]} strokeDasharray={`${dash} ${100-dash}`} strokeDashoffset={25 - s.start} cx="21" cy="21" r="15.91549430918954" fill="transparent" strokeWidth="6" />; })}
      <circle className="donut-hole" cx="21" cy="21" r="10" fill="#0c0f17" />
      <text x="50%" y="50%" textAnchor="middle" dy="0.3em" fontSize="6" fill="#9aa7b8">{total}</text>
    </svg>
    <div className="donut-legend">{segs.slice(0,6).map((s,i)=><div key={s.k} className="legend-row"><span style={{background:colors[i%colors.length]}}></span>{s.k} <em>{s.v}</em></div>)}</div>
  </div>;
}

function Badge({label}){ return <div className="inline-badge">{label}</div>; }

function ExploitPanel({ token }){
  const [techniques, setTechniques] = useState([]);
  const [selected, setSelected] = useState(null);
  const [me,setMe] = useState(null);
  const [editing,setEditing] = useState(false);
  const [form,setForm] = useState({ id:'', category:'', name:'', description:'', template:'' });
  const isAdmin = me?.role==='admin';
  function load(){ fetch('http://localhost:4000/api/techniques').then(r=>r.json()).then(d=>{ setTechniques(d.techniques); try { const want = localStorage.getItem('ti_select_tech_id'); if(want){ const match = d.techniques.find(t=> String(t.id)===want); if(match){ setSelected(match); } localStorage.removeItem('ti_select_tech_id'); } } catch {} }); }
  useEffect(()=>{ load(); },[token]);
  useEffect(()=>{ fetch('http://localhost:4000/api/auth/me',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(setMe).catch(()=>{}); },[token]);

  const toast = useToast();
  function startNew(){ setForm({ id:'', category:'', name:'', description:'', template:'' }); setEditing(true); setSelected(null); }
  function startEdit(){ if(!selected) return; setForm(selected); setEditing(true); }
  async function save(){
    if(!form.name || !form.category) return;
    const body = JSON.stringify({ category:form.category, name:form.name, description:form.description, template:form.template });
    if(form.id){
      await fetch(`http://localhost:4000/api/techniques/${form.id}`, { method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body });
      toast.success('Technique updated');
    } else {
      const res = await fetch('http://localhost:4000/api/techniques', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body });
      const data = await res.json(); if(data.technique) { setSelected(data.technique); toast.success('Technique created'); }
    }
    setEditing(false); load();
  }
  async function remove(){ if(!selected) return; if(!confirm('Delete technique?')) return; await fetch(`http://localhost:4000/api/techniques/${selected.id}`, { method:'DELETE', headers:{ Authorization:'Bearer '+token }}); setSelected(null); load(); toast.info('Technique deleted'); }
  function cancel(){ setEditing(false); if(form.id){ setSelected(form); } }
  return <div className="split">
    <div className="tech-pane">
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <div className="section-label">TECHNIQUES</div>
        {isAdmin && <button className="btn" style={{padding:'6px 10px', fontSize:'.6rem'}} onClick={startNew}><FiPlus/> New</button>}
      </div>
      <div className="tech-list">
        {techniques.map(t => <div key={t.id} className={"tech-item "+(selected?.id===t.id?'selected':'')} onClick={()=>{ setSelected(t); setEditing(false); }}>{t.category}: {t.name}</div>)}
      </div>
    </div>
    <div style={{flex:1, position:'relative'}}>
      {editing ? <div className="card fade-in" style={{height:'100%', overflow:'auto'}}>
        <h3 style={{marginTop:0, display:'flex', alignItems:'center', gap:8}}>{form.id? <><FiEdit2/> Edit Technique</> : <><FiPlus/> New Technique</>}</h3>
        <div className="flex-col" style={{gap:10, maxWidth:680}}>
          <input placeholder="Category" value={form.category} onChange={e=>setForm(f=>({...f, category:e.target.value}))} />
          <input placeholder="Name" value={form.name} onChange={e=>setForm(f=>({...f, name:e.target.value}))} />
          <textarea rows={4} placeholder="Description" value={form.description} onChange={e=>setForm(f=>({...f, description:e.target.value}))} />
          <textarea rows={10} placeholder="Template code" value={form.template} onChange={e=>setForm(f=>({...f, template:e.target.value}))} style={{fontFamily:'var(--mono)'}} />
          <div style={{display:'flex', gap:8}}>
            <button className="btn accent" onClick={save}><FiSave/> Save</button>
            <button className="btn" onClick={cancel}><FiX/> Cancel</button>
          </div>
        </div>
      </div> : selected ? <TechniqueDetail t={selected} isAdmin={isAdmin} startEdit={startEdit} remove={remove}/> : <div className="card card-glow"><h3 style={{marginTop:0}}>Select a technique</h3><p>Browse or create techniques (admins can add / edit).</p></div>}
    </div>
  </div>;
}

function TechniqueDetail({t, isAdmin, startEdit, remove}){
  return <div className="card fade-in" style={{height:'100%', overflow:'auto', position:'relative'}}>
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16}}>
      <div>
        <h2 style={{margin:'0 0 4px'}}>{t.name}</h2>
        <div style={{fontSize:'.6rem', letterSpacing:'.5px', color:'var(--text-dim)', marginBottom:10}}>{t.category}</div>
      </div>
      {isAdmin && <div style={{display:'flex', gap:8}}>
        <button className="btn" style={{padding:'6px 10px', fontSize:'.6rem'}} onClick={startEdit}><FiEdit2/> Edit</button>
        <button className="btn danger" style={{padding:'6px 10px', fontSize:'.6rem'}} onClick={remove}><FiTrash2/> Delete</button>
      </div>}
    </div>
    <p style={{whiteSpace:'pre-wrap'}}>{t.description}</p>
    <div className="section-label" style={{margin:'18px 0 6px'}}>TEMPLATE</div>
    <pre>{t.template}</pre>
    {isAdmin && <StatusModeration t={t} />}
    {isAdmin && <VersionHistory technique={t} />}
  </div>;
}

function StatusModeration({ t }){
  const [status,setStatus] = useState(t.status||'published');
  const tokenRef = useRef(localStorage.getItem('ti_jwt'));
  async function updateStatus(s){ setStatus(s); try { await fetch(`http://localhost:4000/api/techniques/${t.id}/status`, { method:'PATCH', headers:{'Content-Type':'application/json', Authorization:'Bearer '+tokenRef.current}, body: JSON.stringify({ status: s }) }); } catch {} }
  return <div style={{marginTop:12}}>
    <div className="section-label" style={{marginBottom:4}}>STATUS</div>
    <div style={{display:'flex', gap:6}}>
      {['published','draft','archived'].map(s=> <button key={s} className={'btn '+(status===s?'accent':'')} style={{padding:'4px 10px', fontSize:'.55rem'}} onClick={()=>updateStatus(s)}>{s}</button>)}
    </div>
  </div>;
}

function VersionHistory({ technique }){
  const [versions,setVersions] = useState([]);
  const tokenRef = useRef(null);
  useEffect(()=>{ (async()=>{
    try {
      const storedToken = localStorage.getItem('ti_jwt') || localStorage.getItem('ti_token') || localStorage.getItem('token') || sessionStorage.getItem('ti_jwt');
      tokenRef.current = storedToken;
      const r = await fetch(`http://localhost:4000/api/techniques/${technique.id}/versions`, { headers:{ Authorization:'Bearer '+storedToken }});
      if(r.ok){ const data = await r.json(); // assume chronological old->new
        const list = (data.versions||[]).map(v=>({...v}));
        setVersions(list.reverse()); // newest first
      }
    } catch {}
  })(); }, [technique.id]);
  async function revert(i){
    if(!confirm('Revert to this version? A snapshot of the current version will be kept.')) return;
    // i is index in reversed list, convert back
    const originalIndex = versions.length - 1 - i;
    const r = await fetch(`http://localhost:4000/api/techniques/${technique.id}/revert`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+tokenRef.current}, body: JSON.stringify({ index: originalIndex }) });
  if(r.ok){ location.reload(); }
  }
  if(!versions.length) return <div style={{marginTop:18, fontSize:'.6rem', color:'var(--text-dim)'}}>No prior versions.</div>;
  return <div style={{marginTop:22}}>
    <div className="section-label" style={{marginBottom:6}}>VERSIONS</div>
    <div style={{display:'flex', flexDirection:'column', gap:6}}>
      {versions.map((v,i)=>(
  <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'var(--bg-alt)', border:'1px solid var(--border)', padding:'6px 10px', borderRadius:6}}>
          <div style={{fontSize:'.55rem', letterSpacing:'.5px', color:'var(--text-dim)'}}>{new Date(v.ts).toLocaleString()}</div>
          <button className="btn" style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=>revert(i)}>Revert</button>
        </div>
      ))}
    </div>
  </div>;
}

function ConsolePanel({ active, consoleState, setConsoleState, sendConsole, connected }){
  if(!consoleState) return null;
  const { buffer, inputLine } = consoleState;
  const termRef = useRef(null);
  const historyRef = useRef([]); // command history newest first
  const histIndexRef = useRef(-1);
  useEffect(()=>{ if(active && termRef.current){ termRef.current.focus(); termRef.current.scrollTop = termRef.current.scrollHeight; } },[active, buffer]);
  function update(p){ setConsoleState(s=>({...s, ...p})); }
  function handleKey(e){
    if(!active) return;
    if(e.key === 'Enter') { const cmd = inputLine; if(cmd.trim()){ historyRef.current.unshift(cmd); histIndexRef.current=-1; } update({ buffer: buffer + inputLine + '\n', inputLine:'' }); sendConsole(cmd + '\r'); e.preventDefault(); }
    else if(e.key === 'Backspace') { if(inputLine.length){ update({ inputLine: inputLine.slice(0,-1) }); } e.preventDefault(); }
    else if(e.key === 'ArrowUp'){ if(historyRef.current.length){ histIndexRef.current = Math.min(histIndexRef.current + 1, historyRef.current.length-1); update({ inputLine: historyRef.current[histIndexRef.current] }); } e.preventDefault(); }
    else if(e.key === 'ArrowDown'){ if(historyRef.current.length){ histIndexRef.current = Math.max(histIndexRef.current - 1, -1); update({ inputLine: histIndexRef.current===-1? '' : historyRef.current[histIndexRef.current] }); } e.preventDefault(); }
    else if(e.key==='c' && e.ctrlKey){ sendConsole('\u0003'); update({ inputLine:'' }); e.preventDefault(); }
    else if(e.key==='l' && e.ctrlKey){ update({ buffer:'', inputLine:'' }); e.preventDefault(); }
    else if(e.key.length===1 && !e.ctrlKey && !e.metaKey){ update({ inputLine: inputLine + e.key }); e.preventDefault(); }
  }
  if(!active){ return <div style={{display:'none'}} aria-hidden="true" />; }
  return <div className="terminal-wrap" style={{flex:1, display:'flex'}}>
    <div className="card" style={{padding:0, flex:1, display:'flex', flexDirection:'column', minHeight:'calc(100vh - 170px)'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderBottom:'1px solid var(--border)'}}>
        <div style={{fontSize:'.7rem', letterSpacing:'.5px', color:'var(--text-dim)'}}>SHELL (persistent {connected? '• online':'• offline'})</div>
        <div style={{display:'flex', gap:10}}>
          <button className="btn" onClick={()=>update({buffer:'', inputLine:''})}>Clear</button>
          <button className="btn" onClick={()=> { try { const lines = buffer.trim().split(/\n/); const last = lines.slice(-20).join('\n'); navigator.clipboard.writeText(last); } catch {} }}>Copy Last</button>
        </div>
      </div>
  <div ref={termRef} className="terminal" style={{flex:1}} tabIndex={0} onKeyDown={handleKey} onClick={()=>termRef.current?.focus()} dangerouslySetInnerHTML={{__html: ansiToHtml(buffer) + '<span>'+escapeHtml(inputLine)+'</span><span class="cursor"></span>'}} />
      <div style={{padding:'6px 14px', borderTop:'1px solid var(--border)', fontSize:'.6rem', color:'var(--text-dim)'}}>Enter to run • Ctrl+C SIGINT • Ctrl+L clear • Up/Down history • Session persists while logged in.</div>
    </div>
  </div>;
}

// Basic ANSI SGR color/intensity parser -> span wrappers
function CodeEditor({ theme }){
  const defaultFiles = [
    { id:'scratch.js', name:'scratch.js', language:'javascript', value:`// Scratch pad\nfunction hello(){\n  console.log('Threat-Intel');\n}\nhello();` },
  ];
  const stored = (()=>{ try { const parsed = JSON.parse(localStorage.getItem('ti_editor_files')); return Array.isArray(parsed) && parsed.length ? parsed : defaultFiles; } catch { return defaultFiles; } })();
  const storedActive = (()=>{ try { return localStorage.getItem('ti_editor_active') || stored[0].id; } catch { return stored[0].id; } })();
  const [files,setFiles] = useState(stored);
  const [activeId,setActiveId] = useState(storedActive);
  const [runOutput,setRunOutput] = useState('');
  const [wrap,setWrap] = useState(false);
  const [minimap,setMinimap] = useState(false);
  const [fontSize,setFontSize] = useState(14);
  const [cursor,setCursor] = useState({ line:1, col:1 });
  const [showSnippets,setShowSnippets] = useState(false);
  const [snapshots,setSnapshots] = useState(()=>{ try { return JSON.parse(localStorage.getItem('ti_editor_snaps'))||{}; } catch { return {}; } });
  const [diffWith,setDiffWith] = useState(null);
  const editorDivRef = useRef(null);
  const editorRef = useRef(null);
  const modelMapRef = useRef({});
  const disposablesRef = useRef([]);
  const [initError,setInitError] = useState(null);
  const reinitCounterRef = useRef(0);

  // Ensure at least one file always exists
  useEffect(()=>{ if(!files.length){ setFiles(defaultFiles); setActiveId(defaultFiles[0].id); } },[files]);
  const activeFile = files.find(f=>f.id===activeId) || files[0] || defaultFiles[0];

  // Persist files
  useEffect(()=>{ localStorage.setItem('ti_editor_files', JSON.stringify(files)); },[files]);
  useEffect(()=>{ localStorage.setItem('ti_editor_active', activeId); },[activeId]);
  useEffect(()=>{ localStorage.setItem('ti_editor_snaps', JSON.stringify(snapshots)); },[snapshots]);

  // Initialize editor
  useEffect(()=>{
    if(!editorDivRef.current || editorRef.current) return;
    try {
      if(!monaco?.editor) throw new Error('Monaco not loaded');
      editorRef.current = monaco.editor.create(editorDivRef.current, {
          value: activeFile?.value || '',
          language: activeFile?.language || 'javascript',
          theme: theme==='light'? 'vs' : 'vs-dark',
          automaticLayout: true,
          fontSize,
          minimap: { enabled: minimap },
          wordWrap: wrap? 'on':'off',
          smoothScrolling: true,
          scrollBeyondLastLine: false,
      renderWhitespace: 'selection'
      });
      const ed = editorRef.current;
      disposablesRef.current.push(ed.onDidChangeCursorPosition(e=> setCursor({ line:e.position.lineNumber, col:e.position.column })));
      disposablesRef.current.push(ed.onDidChangeModelContent(()=>{
        const val = ed.getValue();
        setFiles(fs => fs.map(f => f.id===activeId ? { ...f, value: val } : f));
        // Simple inline diagnostics: flag TODO comments
        try {
          const model = ed.getModel();
          if(model){
            const text = model.getValue();
            const markers = [];
            text.split(/\n/).forEach((ln,i)=>{ if(/TODO/i.test(ln)){ markers.push({ startLineNumber:i+1,endLineNumber:i+1,startColumn:1,endColumn:ln.length+1,message:'TODO found',severity: monaco.MarkerSeverity.Info }); } });
            monaco.editor.setModelMarkers(model,'ti',markers);
          }
        } catch {}
      }));
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, ()=> saveActive());
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, ()=> runCode());
      ed.addCommand(monaco.KeyCode.F5, ()=> runCode());
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, ()=> saveActive());
      setInitError(null);
    } catch(e){ console.error(e); setInitError(e.message||'Editor failed to load'); }
    return ()=> { disposablesRef.current.forEach(d=> d.dispose && d.dispose()); editorRef.current?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[reinitCounterRef.current]);

  function forceReinit(){
    try { disposablesRef.current.forEach(d=> d.dispose && d.dispose()); } catch {}
    try { editorRef.current?.dispose(); } catch {}
    editorRef.current = null; setInitError(null); reinitCounterRef.current += 1; // triggers effect
  }

  // Theme sync
  useEffect(()=>{
    if(editorRef.current){ monaco.editor.setTheme(theme==='light'? 'vs':'vs-dark'); }
  },[theme]);

  // Wrap, minimap, font size
  useEffect(()=>{ if(editorRef.current){ editorRef.current.updateOptions({ wordWrap: wrap? 'on':'off' }); } },[wrap]);
  useEffect(()=>{ if(editorRef.current){ editorRef.current.updateOptions({ minimap: { enabled: minimap } }); } },[minimap]);
  useEffect(()=>{ if(editorRef.current){ editorRef.current.updateOptions({ fontSize }); } },[fontSize]);

  // Active file switching
  useEffect(()=>{
  if(!editorRef.current || !activeFile) return;
  const key = activeFile.id;
    // Reuse or create model
    let model = modelMapRef.current[key];
    if(!model){
      model = monaco.editor.createModel(activeFile.value, activeFile.language);
      modelMapRef.current[key] = model;
    }
    editorRef.current.setModel(model);
  },[activeId]);

  function saveActive(){
    // Already persisted by effect; provide visual feedback
    setRunOutput(o=>`// Saved ${activeFile.name} at ${new Date().toLocaleTimeString()}`);
  if(!activeFile) return;
  const snap = { id: Date.now(), code: activeFile.value || '', ts: Date.now() };
  setSnapshots(s => { const arr = [...(s[activeFile.id]||[]), snap].slice(-10); return { ...s, [activeFile.id]: arr }; });
  }
  function addFile(){
    const base = 'file'; let i=1; while(files.some(f=>f.name===`${base}${i}.js`)) i++;
    const nf = { id:`${base}${i}.js`, name:`${base}${i}.js`, language:'javascript', value:'// new file\n' };
    setFiles(f=>[...f,nf]); setActiveId(nf.id);
  }
  function closeFile(id){
    if(files.length===1) return; // keep at least one
    const idx = files.findIndex(f=>f.id===id);
    const newFiles = files.filter(f=>f.id!==id);
    setFiles(newFiles);
    if(activeId===id){ const next = newFiles[idx-1] || newFiles[0]; setActiveId(next.id); }
  }
  function renameFile(id){
    const name = prompt('Rename file', files.find(f=>f.id===id)?.name || '');
    if(!name) return;
    if(files.some(f=>f.name===name && f.id!==id)) return alert('Name already exists');
    setFiles(fs=> fs.map(f=> f.id===id? { ...f, id:name, name } : f));
    if(activeId===id) setActiveId(name);
  }
  function changeLanguage(lang){
    setFiles(fs=> fs.map(f=> f.id===activeId? { ...f, language:lang } : f));
    const model = editorRef.current?.getModel();
    if(model){ monaco.editor.setModelLanguage(model, lang); }
  }
  function formatDoc(){ editorRef.current?.getAction('editor.action.formatDocument')?.run(); }
  function runCode(){
    if(activeFile.language!=='javascript' && activeFile.language!=='typescript'){
      setRunOutput('// Run supported only for JavaScript/TypeScript');
      return;
    }
    const code = editorRef.current?.getValue() || '';
    const logs = [];
    const original = { log:console.log, error:console.error, warn:console.warn };
    try {
      console.log = (...a)=>{ logs.push(a.join(' ')); };
      console.error = (...a)=>{ logs.push('[error] '+a.join(' ')); };
      console.warn = (...a)=>{ logs.push('[warn] '+a.join(' ')); };
      // eslint-disable-next-line no-new-func
      const fn = new Function(code);
      const res = fn();
      if(res !== undefined) logs.push('[return] '+JSON.stringify(res));
      setRunOutput(logs.join('\n'));
    } catch(e){ setRunOutput(String(e)); }
    finally { console.log = original.log; console.error = original.error; console.warn = original.warn; }
  }
  const snippets = [
    { name:'HTTP fetch', code:`async function grab(url){\n  const res = await fetch(url);\n  const txt = await res.text();\n  console.log('len', txt.length);\n}\n`},
    { name:'Exploit template', code:`/** Basic exploit POC template */\nasync function exploit(target){\n  // TODO: craft request\n  console.log('Target =>', target);\n}\n`},
    { name:'Bruteforce loop', code:`for(let i=0;i<10;i++){\n  console.log('Attempt', i);\n}\n`}
  ];
  function insertSnippet(sn){
    const ed = editorRef.current; if(!ed) return;
    ed.executeEdits('insert-snippet',[{ range: ed.getSelection(), text: sn.code, forceMoveMarkers:true }]);
    setShowSnippets(false);
  }

  const snapList = snapshots[activeFile.id]||[];
  function openDiff(snap){ setDiffWith(snap); }
  function closeDiff(){ setDiffWith(null); }
  function computeDiff(a,b){
    const aLines = a.split('\n'); const bLines = b.split('\n'); const max = Math.max(aLines.length,bLines.length); const rows=[];
    for(let i=0;i<max;i++){ const oldL=aLines[i]??''; const newL=bLines[i]??''; if(oldL===newL) rows.push({t:'ctx', old:oldL}); else { if(oldL) rows.push({t:'del', old:oldL}); if(newL) rows.push({t:'add', new:newL}); } }
    return rows;
  }
  const diffRows = diffWith? computeDiff(diffWith.code, activeFile.value||'') : [];

  function downloadActive(){
    if(!activeFile) return;
    const blob = new Blob([activeFile.value || ''], { type:'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = activeFile.name;
    a.click();
    setRunOutput(o=>`// Downloaded ${activeFile.name}`);
  }

  return <div className="card" style={{padding:0, display:'flex', flexDirection:'column', height:'calc(100vh - 170px)', position:'relative'}}>
    <div className="editor-tabs">
      <div className="tabs-scroll">
        {files.map(f=> <div key={f.id} className={"editor-tab "+(f.id===activeId?'active':'')} onClick={()=> setActiveId(f.id)}>
          <span onDoubleClick={()=> renameFile(f.id)}>{f.name}</span>
          <button className="tab-close" onClick={(e)=>{ e.stopPropagation(); closeFile(f.id); }} title="Close">×</button>
        </div>)}
        <button className="tab-add" onClick={addFile} title="New file">+</button>
      </div>
      <div className="editor-toolbar">
  <select value={activeFile?.language || 'javascript'} onChange={e=> changeLanguage(e.target.value)}>
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="json">JSON</option>
          <option value="python">Python</option>
          <option value="shell">Shell</option>
          <option value="markdown">Markdown</option>
        </select>
        <button onClick={saveActive}>Save</button>
        <button onClick={formatDoc}>Format</button>
        <button onClick={runCode}>Run</button>
        <button onClick={()=> setWrap(w=>!w)} className={wrap?'on':''} title="Toggle wrap">Wrap</button>
        <button onClick={()=> setMinimap(m=>!m)} className={minimap?'on':''} title="Toggle minimap">Map</button>
        <button onClick={()=> setFontSize(s=> Math.min(24,s+1))}>A+</button>
        <button onClick={()=> setFontSize(s=> Math.max(10,s-1))}>A-</button>
        <button onClick={()=> setShowSnippets(s=>!s)} className={showSnippets?'on':''}>Snippets</button>
        <button onClick={downloadActive} title="Download file">DL</button>
    <button onClick={()=> openDiff(snapList[snapList.length-1])} disabled={!snapList.length}>Diff</button>
      </div>
    </div>
    {showSnippets && <div className="snippet-pop">
      {snippets.map(sn=> <div key={sn.name} className="snippet-item" onClick={()=> insertSnippet(sn)}>{sn.name}</div>)}
    </div>}
  {snapList.length>0 && <div className="snapshots-bar"><div className="snapshots-title">Snaps:</div>{snapList.map(s=> <button key={s.id} className="snap-btn" onClick={()=> openDiff(s)} title={new Date(s.ts).toLocaleTimeString()}>{new Date(s.ts).toLocaleTimeString()}</button>)}</div>}
    {initError ? <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12}}>
      <div style={{fontSize:'.75rem', color:'var(--danger)'}}>Editor failed: {initError}</div>
      <button className="btn" onClick={forceReinit}>Retry Load</button>
    </div> : <div ref={editorDivRef} style={{flex:1, minHeight:0}} />}
    <div className="editor-status">
      <div>L{cursor.line}:C{cursor.col}</div>
  <div style={{flex:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis'}}>{activeFile?.name||''}</div>
      <div style={{opacity:.75}}>Font {fontSize}px</div>
    </div>
    <div className="run-output">
      <div className="run-output-title">OUTPUT</div>
      <pre>{runOutput}</pre>
    </div>
  {diffWith && <DiffModal snap={diffWith} current={activeFile} rows={diffRows} close={closeDiff} />}
  </div>;
}

function DiffModal({ snap, current, rows, close }){
  return <div className="diff-modal" role="dialog" aria-modal="true">
    <div className="diff-card">
      <div className="diff-head">Diff: {current.name}<span style={{marginLeft:8,fontSize:'.6rem',fontWeight:400}}> vs {new Date(snap.ts).toLocaleTimeString()}</span><button className="diff-close" onClick={close}>×</button></div>
      <div className="diff-body">{rows.map((r,i)=> <div key={i} className={'diff-line '+r.t}><div className="gutter">{r.t==='add'?'+':r.t==='del'?'-':' '}</div><pre>{r.old || r.new || ''}</pre></div>)}</div>
    </div>
  </div>;
}

function CommandPalette({ query, setQuery, close, items }){
  useEffect(()=>{ function esc(e){ if(e.key==='Escape'){ close(); } } window.addEventListener('keydown',esc); return ()=> window.removeEventListener('keydown',esc); },[close]);
  return <div className="command-palette" role="dialog" aria-modal="true">
    <div className="command-panel">
      <input autoFocus className="command-input" placeholder="Type a command..." value={query} onChange={e=> setQuery(e.target.value)} />
      <div className="command-list">{items.map((c,i)=> <div key={i} className="command-item" onClick={()=> { c.action(); close(); }}><span className="cmd-label">{c.label}</span><span className="cmd-group">{c.group}</span></div>)}{!items.length && <div className="command-empty">No matches</div>}</div>
      <div className="command-hint">Ctrl+K • Esc to close</div>
    </div>
  </div>;
}

function DBSearch({ token, active }){
  // Restore persisted state if available
  const initialRef = useRef(null);
  if(initialRef.current===null){
    try { initialRef.current = JSON.parse(localStorage.getItem('ti_dbsearch_state')) || {}; } catch { initialRef.current = {}; }
  }
  const [mode,setMode] = useState(initialRef.current.mode || 'single'); // single | batch
  const [emailsInput, setEmailsInput] = useState(initialRef.current.emailsInput || '');
  const [results, setResults] = useState(initialRef.current.results || {});
  const [queue,setQueue] = useState([]);
  const [inFlight,setInFlight] = useState(false);
  const [progress,setProgress] = useState(initialRef.current.progress || { done:0, total:0 });
  const [stats,setStats] = useState(initialRef.current.stats || { breached:0, clear:0, errors:0 });
  const [config,setConfig] = useState({ perMinute:10, batchLimit:10 });
  const [presets,setPresets] = useState(()=>{ try { return JSON.parse(localStorage.getItem('ti_db_presets'))||[]; } catch { return []; } });
  function savePreset(){ const list = parseEmails(); if(!list.length) return; const name = prompt('Preset name'); if(!name) return; const next = [...presets.filter(p=>p.name!==name), { name, emails:list }]; setPresets(next); try { localStorage.setItem('ti_db_presets', JSON.stringify(next)); } catch {} }
  function loadPreset(p){ setEmailsInput(p.emails.join('\n')); }
  const cancelRef = useRef(false);
  const fileInputRef = useRef(null);
  const progressToastRef = useRef(null);
  const toast = useToast();

  // Persist state (omit transient queue/inFlight/cancel)
  useEffect(()=>{
    try { localStorage.setItem('ti_dbsearch_state', JSON.stringify({ mode, emailsInput, results, progress, stats })); } catch {}
  }, [mode, emailsInput, results, progress, stats]);

  useEffect(()=>{ // fetch config
    fetch('http://localhost:4000/api/hibp/config',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(c=>setConfig(c)).catch(()=>{});
  },[token]);

  function parseEmails(raw){
    return (raw ?? emailsInput).split(/[\n,; ]+/).map(s=>s.trim().toLowerCase()).filter((v,i,a)=>v && a.indexOf(v)===i);
  }

  async function runSingle(){
    const list = parseEmails();
    if(!list.length) return;
    setInFlight(true); cancelRef.current=false; setResults({}); setProgress({done:0,total:list.length}); setStats({breached:0,clear:0,errors:0});
    progressToastRef.current = toast.info(`HIBP: 0/${list.length} (0%)`, { ttl:0 });
    const chunks = [];
    for(let i=0;i<list.length;i+=config.batchLimit) chunks.push(list.slice(i,i+config.batchLimit));
    for(const chunk of chunks){
      if(cancelRef.current) break;
      await fireRequest(chunk);
      await delay( (60_000 / config.perMinute) ); // naive pacing (per request as 1 email group)
      updateProgressToast();
    }
    setInFlight(false);
    finalizeProgressToast();
  }

  async function runBatch(){
    const list = parseEmails();
    if(!list.length) return;
    if(list.length>1000){ alert('Batch mode capped at 1000 emails for this UI export.'); return; }
    setInFlight(true); cancelRef.current=false; setResults({}); setProgress({done:0,total:list.length}); setStats({breached:0,clear:0,errors:0});
    const queueLocal = [...list];
    setQueue(queueLocal);
    const intervalMs = Math.ceil(60_000 / config.perMinute);
    progressToastRef.current = toast.info(`HIBP: 0/${queueLocal.length} (0%)`, { ttl:0 });
    for(let i=0;i<queueLocal.length;i++){
      if(cancelRef.current) break;
      const email = queueLocal[i];
      await fireRequest([email]);
      // progress updated inside
      updateProgressToast();
      if(i < queueLocal.length -1) await delay(intervalMs);
    }
    setInFlight(false);
    finalizeProgressToast();
  }

  async function fireRequest(emails){
    try {
      const r = await fetch('http://localhost:4000/api/hibp/search', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body: JSON.stringify({ emails }) });
      const data = await r.json();
      const res = data.results || {};
      setResults(prev => ({ ...prev, ...res }));
      // Update stats
      let breached=0, clear=0, errors=0;
      Object.entries(res).forEach(([email,val])=>{
        if(Array.isArray(val)) { if(val.length) breached++; else clear++; }
        else errors++;
      });
      setStats(s=>({ breached: s.breached+breached, clear: s.clear+clear, errors: s.errors+errors }));
    } catch (e) {
      // mark all emails as error
      setResults(prev => ({ ...prev, ...Object.fromEntries(emails.map(e=>[e,{ error:e.message }])) }));
      setStats(s=>({ ...s, errors: s.errors + emails.length }));
      toast.error('Lookup failed for '+emails.length+' email(s)');
    } finally {
      setProgress(p=>({ done: Math.min(p.done + emails.length, p.total), total: p.total }));
    }
  }

  function updateProgressToast(){
    if(!progressToastRef.current) return;
    const pct = progress.total ? Math.round((progress.done/progress.total)*100) : 0;
    toast.update(progressToastRef.current, `HIBP: ${progress.done}/${progress.total} (${pct}%)`);
  }
  function finalizeProgressToast(){
    if(!progressToastRef.current) return;
    const { breached, clear, errors } = stats;
    toast.update(progressToastRef.current, `HIBP complete • ${breached} breached / ${clear} clear / ${errors} errors`, { ttl: 5000, type: errors? 'error': 'success' });
    progressToastRef.current = null;
  }

  function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function cancel(){ cancelRef.current=true; setInFlight(false); }
  function reset(){ setEmailsInput(''); setResults({}); setProgress({done:0,total:0}); setStats({breached:0,clear:0,errors:0}); cancelRef.current=true; setInFlight(false); }

  // Import handling
  function triggerImport(){ if(inFlight) return; fileInputRef.current?.click(); }
  function handleFile(e){
    const file = e.target.files?.[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result || '';
      const imported = parseEmails(String(text));
      const existing = parseEmails();
      const merged = [...new Set([...existing, ...imported])];
      setEmailsInput(merged.join('\n'));
    };
    reader.readAsText(file);
    e.target.value='';
  }

  // Export
  function exportJSON(){
    const payload = Object.entries(results).map(([email,val])=>({ email, status: Array.isArray(val)? (val.length? 'breached':'clear'):'error', breaches: Array.isArray(val)? val:[], error: Array.isArray(val)? null: val.error || 'error' }));
    downloadBlob(JSON.stringify(payload,null,2), 'hibp_results.json', 'application/json');
  }
  function exportCSV(){
    const header = ['email','status','breach_count','breach_names','error'];
    const rows = Object.entries(results).map(([email,val])=>{
      if(Array.isArray(val)){
        const names = val.map(b=>b.Name).join(';');
        return [email, val.length? 'breached':'clear', val.length, '"'+names.replace(/"/g,'""')+'"',''];
      } else {
        return [email,'error',0,'', '"'+(val.error||'').replace(/"/g,'""')+'"'];
      }
    });
    const csv = [header.join(','), ...rows.map(r=>r.join(','))].join('\n');
    downloadBlob(csv, 'hibp_results.csv', 'text/csv');
  }
  function downloadBlob(content, filename, type){
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 2000);
  }

  // Derived
  const percent = progress.total ? Math.round((progress.done/progress.total)*100) : 0;
  const firstStartRef = useRef(null);
  if(progress.total && progress.done && !firstStartRef.current){ firstStartRef.current = Date.now(); }
  let etaText='';
  if(firstStartRef.current && progress.done>0 && progress.done < progress.total){
    const elapsed = (Date.now() - firstStartRef.current)/1000; // seconds
    const perItem = elapsed / progress.done;
    const remaining = perItem * (progress.total - progress.done);
    const mins = Math.floor(remaining/60); const secs = Math.round(remaining % 60);
    etaText = 'ETA '+ (mins>0? mins+'m ':'') + secs + 's';
  } else if(progress.done && progress.done===progress.total && firstStartRef.current){
    const totalSec = (Date.now() - firstStartRef.current)/1000;
    etaText = 'Completed in '+ totalSec.toFixed(1)+'s';
  }

  if(!active){
    // Keep mounted but hidden to preserve state & allow background viewing (no network while hidden)
    return <div style={{display:'none'}} aria-hidden="true" />;
  }
  return <div className="card" style={{width:'100%', minHeight:'calc(100vh - 170px)', display:'flex', flexDirection:'column'}}>
    <h3 style={{marginTop:0}}>Have I Been Pwned Lookup</h3>
    <input ref={fileInputRef} type="file" accept=".txt,.csv" style={{display:'none'}} onChange={handleFile} />
    <div style={{display:'flex', flexWrap:'wrap', gap:16}}>
      <div style={{flex:'0 0 360px', display:'flex', flexDirection:'column', gap:14}}>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <button className={"btn "+(mode==='single'?'accent':'')} onClick={()=>setMode('single')} disabled={inFlight}>Single Request</button>
          <button className={"btn "+(mode==='batch'?'accent':'')} onClick={()=>setMode('batch')} disabled={inFlight}>Batch (1/email)</button>
          <button className="btn" onClick={triggerImport} disabled={inFlight}>Import</button>
          <button className="btn" onClick={exportJSON} disabled={!Object.keys(results).length}>Export JSON</button>
          <button className="btn" onClick={exportCSV} disabled={!Object.keys(results).length}>Export CSV</button>
        </div>
        <textarea rows={12} value={emailsInput} onChange={e=>setEmailsInput(e.target.value)} placeholder={mode==='batch'?"Up to 1000 emails (one per line)":`Up to ${config.batchLimit} per POST (auto-chunked)`} />
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          {!inFlight && <button className="btn accent" onClick={mode==='single'?runSingle:runBatch} disabled={!emailsInput.trim()}>Run</button>}
          {inFlight && <button className="btn danger" onClick={cancel}>Cancel</button>}
          <button className="btn" onClick={reset} disabled={inFlight && percent<100}>Reset</button>
          <button className="btn" onClick={savePreset} disabled={!emailsInput.trim() || inFlight}>Save Preset</button>
        </div>
        {presets.length>0 && <div style={{display:'flex', flexWrap:'wrap', gap:6}}>{presets.map(p=> <button key={p.name} className="btn" style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=>loadPreset(p)}>{p.name}</button>)}</div>}
        <div style={{fontSize:'.65rem', color:'var(--text-dim)'}}>Limit: {config.perMinute} req/min • Request size limit: {config.batchLimit} • Mode: {mode}</div>
        {progress.total>0 && <div style={{display:'flex', flexDirection:'column', gap:6}}>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:'.65rem', color:'var(--text-dim)'}}>
            <span>{progress.done}/{progress.total} processed</span><span>{percent}% {etaText && <em style={{fontStyle:'normal', color:'var(--ok)', marginLeft:8}}>{etaText}</em>}</span>
          </div>
          <div style={{position:'relative', height:10, background:'var(--bg-alt)', borderRadius:5, overflow:'hidden', boxShadow:'inset 0 0 0 1px var(--border)'} }>
            <div style={{position:'absolute', inset:0, background:'repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0 10px, transparent 10px 20px)'}}></div>
            <div style={{height:'100%', width:percent+'%', background:'linear-gradient(90deg,#15803d,#16a34a,#22c55e)', boxShadow:'0 0 0 1px rgba(0,0,0,.25),0 2px 6px -2px rgba(0,0,0,.6)', transition:'width .4s cubic-bezier(.4,.0,.2,1)'}} />
          </div>
          <div style={{display:'flex', gap:10, fontSize:'.6rem'}}>
            <div style={{color:'var(--ok)'}}>Breached: {stats.breached}</div>
            <div style={{color:'#64748b'}}>Clear: {stats.clear}</div>
            <div style={{color:'var(--danger)'}}>Errors: {stats.errors}</div>
          </div>
        </div>}
      </div>
      <div style={{flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:12}}>
        {Object.keys(results).length===0 && <div className="card card-glow"><h4 style={{margin:'0 0 6px'}}>No Results</h4><p style={{margin:0, fontSize:'.75rem'}}>Enter or import emails, then run a lookup.</p></div>}
        {Object.entries(results).map(([email,val])=> (
          <div key={email} className="card" style={{padding:'14px 16px'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12}}>
              <div style={{fontWeight:600, fontSize:'.75rem', letterSpacing:'.5px'}}>{email}</div>
              <div className={"inline-badge "+(Array.isArray(val)? (val.length? 'badge-breached':'badge-clear'):'badge-error')}>
                {Array.isArray(val)? (val.length? val.length+' breach(es)':'clear'): 'error'}
              </div>
            </div>
            {Array.isArray(val) ? (
              val.length===0 ? <div style={{color:'var(--ok)', fontSize:'.65rem', marginTop:4}}>No breaches found.</div> :
              <div className="table-scroll" style={{marginTop:8}}>
                <table><thead><tr><th>Name</th><th>Domain</th><th>Date</th></tr></thead><tbody>{val.map(b => <tr key={b.Name}><td>{b.Name}</td><td>{b.Domain}</td><td>{b.BreachDate}</td></tr>)}</tbody></table>
              </div>
            ) : <pre style={{marginTop:8}}>{JSON.stringify(val,null,2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  </div>
}

function VulnSearch({ token }){
  const [keyword, setKeyword] = useState('');
  const [rawResults, setRawResults] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function search(){
    if(!keyword) return;
    setLoading(true); setRawResults(null); setError('');
    try {
      const r = await fetch('http://localhost:4000/api/cve?keyword='+encodeURIComponent(keyword), { headers: { Authorization: 'Bearer '+token }});
      const data = await r.json();
      if(!r.ok){ throw new Error(data.error || 'Search failed'); }
      setRawResults(data);
    } catch(e){ setError(e.message); }
    finally { setLoading(false); }
  }
  // Normalize to an array
  const list = Array.isArray(rawResults) ? rawResults :
    Array.isArray(rawResults?.vulnerabilities) ? rawResults.vulnerabilities :
    Array.isArray(rawResults?.vulnMatch) ? rawResults.vulnMatch : [];
  return <div className="card">
    <h3 style={{marginTop:0}}>CVE Search</h3>
    <div style={{display:'flex', gap:10, marginBottom:14}}>
      <input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="e.g., OpenSSL" />
      <button className="btn accent" onClick={search} disabled={loading}>{loading?'...':'Search'}</button>
    </div>
    {error && <div style={{color:'var(--danger)', fontSize:'.65rem', marginBottom:10}}>{error}</div>}
    {loading && <div style={{fontSize:'.65rem', color:'var(--text-dim)'}}>Searching...</div>}
    {!loading && !error && list.length===0 && rawResults && <div style={{fontSize:'.65rem', color:'var(--text-dim)'}}>No results.</div>}
    {list.length>0 && <div className="table-scroll"><table>
      <thead><tr><th>CVE</th><th>Published</th><th>Score</th><th>Description</th></tr></thead>
      <tbody>
        {list.slice(0,50).map(v => {
          const id = v.cve?.id || v.id || v.cve?.CVE_data_meta?.ID || v.id || 'Unknown';
            const desc = v.cve?.descriptions?.[0]?.value || v.descriptions?.[0]?.value || v.description || '';
            const metrics = v.metrics || {};
            const score = metrics.cvssMetricV31?.[0]?.cvssData?.baseScore || metrics.cvssMetricV2?.[0]?.cvssData?.baseScore || '';
            return <tr key={id}><td>{id}</td><td>{v.published || v.publishedDate || ''}</td><td>{score}</td><td style={{maxWidth:420, whiteSpace:'normal'}}>{desc}</td></tr>;
        })}
      </tbody>
    </table></div>}
  </div>;
}

function FSWA({ token }){
  // Tabs: whois | shodan | plugins
  const [tab,setTab] = useState('whois');
  // WHOIS
  const [target,setTarget] = useState('example.com');
  const [whoisData,setWhoisData] = useState(null);
  const [whoisLoading,setWhoisLoading] = useState(false);
  const [whoisError,setWhoisError] = useState('');
  const [showWhoisRaw,setShowWhoisRaw] = useState(false);
  // Shodan
  const [ip,setIp] = useState('1.1.1.1');
  const [domain,setDomain] = useState('example.com');
  const [shodanData,setShodanData] = useState(null);
  const [shodanLoading,setShodanLoading] = useState(false);
  const [shodanError,setShodanError] = useState('');
  // WP Plugins
  const [wpTarget,setWpTarget] = useState('example.com');
  const [wpDeep,setWpDeep] = useState(false);
  const [wpExtra,setWpExtra] = useState('');
  const [wpData,setWpData] = useState(null);
  const [wpLoading,setWpLoading] = useState(false);
  const [wpError,setWpError] = useState('');
  const [wpExpand,setWpExpand] = useState(null); // slug for which evidence open

  async function runWhois(){
    if(!target.trim()) return;
    const norm = target.replace(/^https?:\/\//i,'').split(/[\/#?]/)[0];
    setWhoisLoading(true); setWhoisError(''); setWhoisData(null);
    try {
      const r = await fetch('http://localhost:4000/api/assess/whois?target='+encodeURIComponent(norm), { headers:{ Authorization:'Bearer '+token }});
      const data = await r.json(); if(!r.ok) throw new Error(data.error||'whois failed'); setWhoisData(data.data);
    } catch(e){ setWhoisError(e.message); }
    finally { setWhoisLoading(false); }
  }
  async function runShodan(){
    if(!ip.trim() && !domain.trim()) return;
    setShodanLoading(true); setShodanError(''); setShodanData(null);
    try {
      let url;
      if(domain && !ip){ url = 'http://localhost:4000/api/assess/shodan?domain='+encodeURIComponent(domain); }
      else { url = 'http://localhost:4000/api/assess/shodan?ip='+encodeURIComponent(ip); }
      const r = await fetch(url, { headers:{ Authorization:'Bearer '+token }});
      const data = await r.json(); if(!r.ok) throw new Error(data.error||'shodan failed'); setShodanData(data);
    } catch(e){ setShodanError(e.message); }
    finally { setShodanLoading(false); }
  }
  async function runWpPlugins(){
    if(!wpTarget.trim()) return;
    const norm = wpTarget.replace(/^https?:\/\//i,'').split(/[\/#?]/)[0];
    setWpLoading(true); setWpError(''); setWpData(null); setWpExpand(null);
    try {
      let url = 'http://localhost:4000/api/assess/wpplugins?target='+encodeURIComponent(norm)+(wpDeep?'&deep=1':'');
      if(wpExtra.trim()) url += '&extra='+encodeURIComponent(wpExtra.trim());
      const r = await fetch(url, { headers:{ Authorization:'Bearer '+token }});
      const data = await r.json(); if(!r.ok) throw new Error(data.error||'scan failed'); setWpData(data);
    } catch(e){ setWpError(e.message); }
    finally { setWpLoading(false); }
  }
  function pretty(obj){ try { return JSON.stringify(obj,null,2); } catch { return String(obj); } }
  return <div className="card" style={{minHeight:'calc(100vh - 170px)', width:'100%', display:'flex', flexDirection:'column', fontSize:'.9rem', padding:'26px 30px'}}>
    <h3 style={{marginTop:0, fontSize:'1.1rem'}}>First Stage Web Application Assessment</h3>
    <p style={{margin:'4px 0 14px', fontSize:'.72rem', color:'var(--text-dim)', lineHeight:1.4}}>Recon helpers. Tabs: WHOIS, Shodan host banners, WordPress plugin heuristic detection.</p>
    <div style={{display:'flex', gap:8, marginBottom:14}}>
      {['whois','shodan','plugins'].map(t=> <button key={t} className={'btn '+(tab===t?'accent':'')} style={{padding:'6px 12px', fontSize:'.6rem'}} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>)}
    </div>
    {tab==='whois' && <div style={{display:'flex', gap:24, flexWrap:'wrap'}}>
      <div style={{flex:'1 1 520px', minWidth:360, display:'flex', flexDirection:'column', gap:10}}>
        <div className="section-label" style={{fontSize:'.7rem'}}>WHOIS Lookup</div>
        <div style={{display:'flex', gap:8}}>
          <input value={target} onChange={e=>setTarget(e.target.value)} placeholder="domain or ip" />
          <button className="btn accent" onClick={runWhois} disabled={whoisLoading}>{whoisLoading?'...':'Run'}</button>
        </div>
        {whoisError && <div className="form-error" style={{marginTop:4}}>{whoisError}</div>}
        {whoisData && <div style={{display:'flex', flexDirection:'column', gap:10}}>
          {whoisData.summary && <div className="card" style={{padding:'12px 14px'}}>
            <div style={{fontSize:'.7rem', letterSpacing:'.5px', color:'var(--text-dim)', marginBottom:6}}>SUMMARY</div>
            <div style={{display:'grid', gridTemplateColumns:'140px 1fr', gap:'6px 14px', fontSize:'.7rem', lineHeight:1.3}}>
              {Object.entries(whoisData.summary).filter(([k,v])=> v && k!=='nameServers' && k!=='status').map(([k,v])=> <React.Fragment key={k}><div style={{textTransform:'capitalize', opacity:.65}}>{k}</div><div>{String(v)}</div></React.Fragment>)}
              {Array.isArray(whoisData.summary.nameServers) && <><div>NS</div><div>{whoisData.summary.nameServers.join(', ')}</div></>}
              {Array.isArray(whoisData.summary.status) && <><div>Status</div><div>{whoisData.summary.status.join(', ')}</div></>}
            </div>
          </div>}
          {whoisData.errorMessage && <div className="card danger" style={{padding:'12px 14px', background:'linear-gradient(var(--danger-bg), var(--danger-bg2))'}}>
            <div style={{fontSize:'.7rem', fontWeight:600, marginBottom:6}}>WHOIS ERROR</div>
            <div style={{fontSize:'.7rem', whiteSpace:'pre-wrap', lineHeight:1.4}}>{whoisData.errorMessage}</div>
          </div>}
          <div className="card" style={{padding:'12px 14px'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div style={{fontSize:'.7rem', letterSpacing:'.5px', color:'var(--text-dim)'}}>FIELDS ({Object.keys(whoisData.parsed?.fields||{}).length})</div>
              <button className="btn" style={{padding:'6px 10px', fontSize:'.6rem'}} onClick={()=>setShowWhoisRaw(s=>!s)}>{showWhoisRaw? 'Hide Raw':'Show Raw'}</button>
            </div>
            <div className="table-scroll" style={{maxHeight:220, marginTop:8, fontSize:'.67rem'}}>
              <table><thead><tr><th style={{width:160}}>Key</th><th>Value</th></tr></thead><tbody>
                {Object.entries(whoisData.parsed?.fields||{}).slice(0,240).map(([k,v])=> <tr key={k}><td style={{fontWeight:600}}>{k}</td><td style={{whiteSpace:'pre-wrap', lineHeight:1.3}}>{Array.isArray(v)? v.join(', '): String(v)}</td></tr>)}
              </tbody></table>
            </div>
            {showWhoisRaw && <pre style={{marginTop:10, fontSize:'.6rem', maxHeight:200, overflow:'auto', lineHeight:1.35}}>{whoisData.raw}</pre>}
            {whoisData.disclaimer && !showWhoisRaw && <div style={{marginTop:10, fontSize:'.55rem', opacity:.6, lineHeight:1.35}}>{whoisData.disclaimer.slice(0,600)}{whoisData.disclaimer.length>600?'…':''}</div>}
          </div>
        </div>}
        {!whoisData && !whoisLoading && !whoisError && <div className="card card-glow"><p style={{margin:0, fontSize:'.62rem'}}>Enter a target domain and run WHOIS.</p></div>}
      </div>
    </div>}
    {tab==='shodan' && <div style={{display:'flex', flexDirection:'column', gap:14, maxWidth:780}}>
      <div className="section-label" style={{fontSize:'.7rem'}}>Shodan Host Info</div>
      <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
        <input style={{flex:'1 1 140px'}} value={ip} onChange={e=>setIp(e.target.value)} placeholder="ip (or leave blank)" />
        <input style={{flex:'1 1 140px'}} value={domain} onChange={e=>setDomain(e.target.value)} placeholder="domain (alt)" />
        <button className="btn accent" onClick={runShodan} disabled={shodanLoading}>{shodanLoading?'...':'Run'}</button>
      </div>
      {shodanError && <div className="form-error" style={{marginTop:4}}>{shodanError}</div>}
      {shodanData && <div className="table-scroll" style={{maxHeight:300, fontSize:'.72rem'}}>
        <table><thead><tr><th style={{width:150}}>IP</th><th>Org</th><th>OS</th><th>Ports</th></tr></thead><tbody>
          {(shodanData.hosts||[]).map(h=> <tr key={h.ip}><td style={{fontWeight:600}}>{h.ip}</td><td>{h.data?.org || h.data?.isp || ''}</td><td>{h.data?.os || ''}</td><td style={{whiteSpace:'normal'}}>{Array.isArray(h.data?.ports)? h.data.ports.slice(0,15).join(', '): (h.data?.port || '')}</td></tr>)}
        </tbody></table>
      </div>}
      {shodanData?.hosts && shodanData.hosts[0]?.data?.data && <div className="card" style={{padding:'10px 12px', maxHeight:220, overflow:'auto'}}>
        <div style={{fontSize:'.65rem', letterSpacing:'.5px', color:'var(--text-dim)', marginBottom:6}}>FIRST HOST SAMPLE BANNERS</div>
        <pre style={{margin:0, fontSize:'.6rem', lineHeight:1.35}}>{pretty((shodanData.hosts[0].data.data||[]).slice(0,3))}</pre>
      </div>}
      {!shodanData && !shodanLoading && !shodanError && <div className="card card-glow"><p style={{margin:0, fontSize:'.62rem'}}>Enter IP or domain for Shodan host lookup.</p></div>}
      <div style={{fontSize:'.55rem', color:'var(--text-dim)'}}>Shodan requires server env var SHODAN_KEY. Data truncated.</div>
    </div>}
    {tab==='plugins' && <div style={{display:'flex', flexDirection:'column', gap:14}}>
      <div className="section-label" style={{fontSize:'.7rem'}}>WordPress Plugin Detection (Heuristic)</div>
      <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
        <input style={{flex:'1 1 220px'}} value={wpTarget} onChange={e=>setWpTarget(e.target.value)} placeholder="target domain" />
        <input style={{flex:'1 1 260px'}} value={wpExtra||''} onChange={e=>setWpExtra(e.target.value)} placeholder="extra slugs (comma sep)" />
        <label style={{display:'flex', alignItems:'center', gap:4, fontSize:'.55rem'}}><input type="checkbox" checked={wpDeep} onChange={e=>setWpDeep(e.target.checked)} /> Deep</label>
        <button className="btn accent" onClick={runWpPlugins} disabled={wpLoading}>{wpLoading?'...':'Scan'}</button>
      </div>
      {wpError && <div className="form-error" style={{marginTop:4}}>{wpError}</div>}
      {wpData && !wpData.ok && <div className="card danger" style={{padding:'10px 12px'}}><div style={{fontSize:'.65rem'}}>Fetch failed: {wpData.error||'error'}</div></div>}
      {wpData?.notWordPress && <div className="card" style={{padding:'10px 12px', background:'linear-gradient(var(--bg-alt), var(--bg-alt2))'}}>
        <div style={{fontSize:'.65rem', lineHeight:1.4}}>Site doesn't appear to be WordPress.<br/><span style={{opacity:.7}}>{wpData.reason}</span></div>
      </div>}
      {wpData?.ok && <>
        <div style={{display:'flex', gap:16, flexWrap:'wrap', fontSize:'.6rem', color:'var(--text-dim)'}}>
          <div>Target: <strong style={{color:'var(--text)'}}>{wpData.target}</strong></div>
          <div>HTTP: {wpData.status}</div>
          <div>Plugins: {wpData.plugins.length}</div>
          <div>Mode: {wpDeep? 'deep':'lite'}</div>
          {wpData.cached && <div style={{color:'var(--ok)'}}>Cached</div>}
          <div>Fetched {new Date(wpData.fetchedAt).toLocaleTimeString()}</div>
        </div>
        {wpData.plugins.length===0 && <div className="card card-glow"><p style={{margin:0, fontSize:'.62rem'}}>No plugin paths detected in initial HTML.</p></div>}
        {wpData.plugins.length>0 && <div className="table-scroll" style={{maxHeight:360, fontSize:'.65rem'}}>
          <table><thead><tr><th style={{width:180}}>Plugin</th><th>Version</th><th>Confidence</th><th>REST</th><th>Source</th><th>Evidence</th></tr></thead><tbody>
            {wpData.plugins.map(p=>{
              const open = wpExpand===p.slug;
              return <React.Fragment key={p.slug}>
                <tr className={open?'open':''} onClick={()=> setWpExpand(s=> s===p.slug? null : p.slug)} style={{cursor:'pointer'}}>
                  <td style={{fontWeight:600}}>{p.name || p.slug}{p.originalSlug && p.originalSlug!==p.slug && <span style={{marginLeft:4, opacity:.6, fontWeight:400}}>({p.originalSlug})</span>}{p.readme && <span style={{marginLeft:6, color:'var(--ok)'}}>✓</span>}{p.signature && !p.readme && <span style={{marginLeft:6, color:'#f59e0b'}}>sig</span>}{p.source==='enumerated' && <span style={{marginLeft:6, color:'#3b82f6'}}>enum</span>}</td>
                  <td>{p.version||''}</td>
                  <td>{Math.round((p.confidence||0)*100)}%</td>
                  <td>{p.restStatus==='verified'? <span style={{color:'var(--ok)'}}>✔</span>: p.restStatus==='protected'? <span style={{color:'#f59e0b'}}>!</span>: ''}</td>
                  <td>{p.source|| (p.signature? 'signature':'path')}</td>
                  <td>{(p.evidence||[]).length}</td>
                </tr>
                {open && <tr>
                  <td colSpan={6} style={{background:'var(--bg-alt)'}}>
                    <div style={{display:'flex', flexDirection:'column', gap:6}}>
                      {(p.evidence||[]).slice(0,6).map((sn,i)=><pre key={i} style={{margin:0, fontSize:'.55rem', whiteSpace:'pre-wrap', background:'var(--bg)', padding:'6px 8px', borderRadius:4, lineHeight:1.3}}>{sn}</pre>)}
                      {p.readme && <div style={{fontSize:'.55rem', color:'var(--ok)'}}>readme.txt fetched{p.version? ' • version '+p.version:''}</div>}
                      {p.signature && !p.readme && <div style={{fontSize:'.55rem', color:'#f59e0b'}}>signature pattern only (lower confidence)</div>}
                      {p.restStatus==='verified' && <div style={{fontSize:'.55rem', color:'var(--ok)'}}>REST endpoint responded 200 (strong confirmation)</div>}
                      {p.restStatus==='protected' && <div style={{fontSize:'.55rem', color:'#f59e0b'}}>REST endpoint access blocked (probable existence)</div>}
                      {p.source==='enumerated' && !p.readme && <div style={{fontSize:'.55rem', color:'#3b82f6'}}>enumeration path/protection hint</div>}
                    </div>
                  </td>
                </tr>}
              </React.Fragment>;
            })}
          </tbody></table>
        </div>}
        <div style={{fontSize:'.55rem', color:'var(--text-dim)', marginTop:8}}>Confidence layers: path/signature + readme + REST (✔ strong / ! protected) + version. Click a row to expand evidence.</div>
      </>}
      {!wpData && !wpLoading && !wpError && <div className="card card-glow"><p style={{margin:0, fontSize:'.62rem'}}>Enter a WordPress site domain (no protocol) and run scan.</p></div>}
    </div>}
  </div>;
}

function Settings({ token, setToken, logout, theme, setTheme }){
  const [users,setUsers] = useState([]);
  const [me,setMe] = useState(null);
  useEffect(()=>{ if(token){ fetch('http://localhost:4000/api/auth/me',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(setMe).catch(()=>{}); } },[token]);
  function loadUsers(){ if(!token) return; fetch('http://localhost:4000/api/admin/users',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(d=>setUsers(d.users||[])).catch(()=>{}); }
  useEffect(()=>{ if(token) loadUsers(); },[token]);
  async function changeRole(id, role){ await fetch(`http://localhost:4000/api/admin/users/${id}/role`, { method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ role }) }); loadUsers(); }
  return <div className="card" style={{maxWidth:980}}>
    <h3 style={{marginTop:0}}>Settings</h3>
    {token ? <div style={{display:'flex', gap:10, flexWrap:'wrap'}}>
  <button className="btn" onClick={logout}>Logout</button>
      {me?.role==='admin' && <button className="btn" onClick={loadUsers}>Refresh Users</button>}
      <button className="btn" onClick={()=> setTheme(theme==='dark'?'light':'dark')}>Theme: {theme}</button>
    </div> : <div style={{fontSize:'.8rem'}}>Login required for features.</div>}
    {me?.role==='admin' && <div style={{marginTop:24}}>
      <div className="section-label" style={{marginBottom:8}}>USERS</div>
      <div className="table-scroll" style={{maxHeight:320}}>
        <table><thead><tr><th>Email</th><th>Role</th><th>Created</th><th style={{width:160}}></th></tr></thead><tbody>
          {users.map(u=> <tr key={u.id}><td>{u.email}</td><td>{u.role}</td><td>{u.created_at? new Date(u.created_at).toLocaleDateString():''}</td><td style={{display:'flex', gap:6}}>{u.role!=='admin' && <button className="btn" style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=>changeRole(u.id,'admin')}>Make Admin</button>}{u.role!=='user' && <button className="btn" style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=>changeRole(u.id,'user')}>Make User</button>}</td></tr>) }
        </tbody></table>
      </div>
    </div>}
  <p style={{marginTop:28}}>Planned: API key management, persistence selection, export/import technique library, password resets.</p>
  </div>
}

function AdminPanel({ token }){
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
  useEffect(()=>{ if(token) (async()=>{
    try {
      const r= await fetch('http://localhost:4000/api/metrics',{ headers:{ Authorization:'Bearer '+token }});
      const d= await r.json();
      if(!r.ok) throw new Error(d.error||'metrics failed');
      setMetricsData(d);
    } catch(e){ setMetricsErr(e.message); }
  })(); },[token]);
  if(!me) return <div className="card"><h3 style={{marginTop:0}}>Admin</h3><div style={{fontSize:'.65rem', color:'var(--text-dim)'}}>Loading...</div></div>;
  if(me.role!=='admin') return <div className="card"><h3 style={{marginTop:0}}>Admin</h3><div style={{color:'var(--danger)', fontSize:'.7rem'}}>Access denied.</div></div>;
  // Build tiles & charts from metricsData if present
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
          <BarSeries data={metricsData.series} />
        </div>
        <div className="card" style={{flex:'0 0 300px'}}>
          <h3 style={{marginTop:0}}>Last 24h Types</h3>
          <MiniDonut counts={metricsData.last24} />
        </div>
      </div>
      <div className="card" style={{gridColumn:'1 / -1'}}>
        <h3 style={{marginTop:0}}>Recent Activity</h3>
        <div className="table-scroll" style={{maxHeight:240}}>
          <table><thead><tr><th>Time</th><th>User</th><th>Type</th><th>Meta</th></tr></thead><tbody>
            {metricsData.recent.map((r,i)=><tr key={i}><td>{new Date(r.ts).toLocaleTimeString()}</td><td>{r.user}</td><td>{r.type}</td><td><code style={{fontSize:'.6rem'}}>{JSON.stringify(r.meta)}</code></td></tr>)}
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

createRoot(document.getElementById('root')).render(<App/>);

// ---------------- Toast Notification System ----------------
const ToastContext = createContext(null);

function ToastProvider({ children }){
  const [toasts,setToasts] = useState([]); // {id,type,msg,ttl?}
  const push = useCallback((type,msg,opts={})=>{
    const id = Math.random().toString(36).slice(2);
    const ttl = opts.ttl ?? 4000;
    setToasts(ts=>{
      const next = [...ts,{ id,type,msg }];
      // cap queue length
      if(next.length>5) next.shift();
      return next;
    });
    if(ttl>0){ setTimeout(()=> setToasts(ts=> ts.filter(t=>t.id!==id)), ttl); }
    return id;
  },[]);
  const update = useCallback((id,msgOrFn,opts={})=>{
    setToasts(ts=> ts.map(t=> t.id===id? { ...t, msg: typeof msgOrFn==='function'? msgOrFn(t.msg): msgOrFn, type: opts.type || t.type }: t));
    if(opts.ttl){ setTimeout(()=> setToasts(ts=> ts.filter(t=> t.id!==id)), opts.ttl); }
  },[]);
  const once = useCallback((key,type,msg,opts={})=>{
    const storageKey = 'ti_toast_once_'+key;
    if(localStorage.getItem(storageKey)) return;
    const id = push(type,msg,opts);
    // mark when dismissed
    setTimeout(()=> localStorage.setItem(storageKey,'1'), 50);
    return id;
  },[push]);
  const api = {
    info:(m,o)=>push('info',m,o),
    success:(m,o)=>push('success',m,o),
    error:(m,o)=>push('error',m,o),
    update,
    once:(key,msg,type='info',opts)=> once(key,type,msg,opts)
  };
  return <ToastContext.Provider value={api}>{children}<div className="toasts">{toasts.map(t=> <Toast key={t.id} t={t} dismiss={()=> setToasts(ts=> ts.filter(x=>x.id!==t.id))} />)}</div></ToastContext.Provider>;
}

function useToast(){ return useContext(ToastContext); }

function Toast({ t, dismiss }){
  return <div className={"toast toast-"+t.type+" pop-in"} role="status" aria-live="polite">
    <div className="toast-icon">{t.type==='success'? '✔' : t.type==='error'? '✖' : 'ℹ'}</div>
    <div style={{flex:1}}>{t.msg}</div>
    <button className="toast-close" onClick={dismiss}>×</button>
  </div>;
}

function Toasts(){ return null; }

// ---------------- OSINT Panel (Framework Tree + Radial) ----------------
/*
  Integrates upstream OSINT Framework (MIT Licensed, © Justin Nordine) by fetching arf.json
  and rendering a collapsible tree. Also retains a compact radial overview.
*/

function OSINTPanel(){
  const [mode,setMode] = useState('tree');
  const [collapsed,setCollapsed] = useState(()=> new Set());
  const [scale,setScale] = useState(1);
  const [fit,setFit] = useState(true); // auto-fit width
  const containerRef = useRef(null);
  const [viewport,setViewport] = useState({ w:0, h:0 });
  const [data] = useState(()=> arfData);
  const root = useMemo(()=>{ if(!data) return null; let i=0; function walk(n,depth=0,parentId='r'){ const id=parentId+'-'+(i++).toString(36); return { ...n, __id:id, depth, children:(n.children||[]).map(c=> walk(c,depth+1,id)) }; } return walk(data); },[data]);
  const layout = useMemo(()=>{ 
    if(!root) return null; 
    const nodes=[]; const links=[]; let y=0; const rowH=20; const xGap=260; const leftPad=20; const topPad=10;
    function walk(n){ nodes.push({ n, x:n.depth*xGap, y:y*rowH }); const isCol=collapsed.has(n.__id); y++; if(!isCol){ (n.children||[]).forEach(c=>{ links.push({ from:n, to:c }); walk(c); }); } }
    walk(root);
    // Estimate label widths to avoid clipping (approx 7px per char + base)
    const labelWidth = nodes.reduce((m,o)=> Math.max(m, (o.n.name||'').length*7 + 24), 0);
    const nodeMap=Object.fromEntries(nodes.map(o=>[o.n.__id,o]));
    const linkPaths=links.map(l=>{ const a=nodeMap[l.from.__id]; const b=nodeMap[l.to.__id]; const mx=(a.x+b.x)/2; return `M${a.x+leftPad},${a.y+topPad}C${mx+leftPad},${a.y+topPad} ${mx+leftPad},${b.y+topPad} ${b.x+leftPad},${b.y+topPad}`; });
    const maxX = Math.max(...nodes.map(o=>o.x));
    const width = maxX + leftPad + labelWidth; // include label room
    const height = (y+1)*rowH + topPad + 40;
    return { nodes, links, linkPaths, width, height, leftPad, topPad };
  },[root, collapsed]);
  function toggle(n){ if(!n.children||!n.children.length) return; setCollapsed(s=>{ const ns=new Set(s); ns.has(n.__id)? ns.delete(n.__id): ns.add(n.__id); return ns; }); }
  // Auto fit width scaling
  // Track container size for centering
  useEffect(()=>{ if(!containerRef.current) return; const el=containerRef.current; const ro=new ResizeObserver(()=> setViewport({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setViewport({ w: el.clientWidth, h: el.clientHeight }); return ()=> ro.disconnect(); },[]);
  // Auto fit width scaling
  useEffect(()=>{ if(!layout || !containerRef.current || !fit) return; const available = viewport.w - 32; if(available>0){ const next = Math.min(1, available / layout.width); setScale(next<0.1?0.1:next); } },[layout, fit, viewport]);
  // Center offsets (in unscaled coords)
  const offsets = useMemo(()=>{ if(!layout) return { x:0, y:0 }; const viewW = viewport.w/scale; const viewH = viewport.h/scale; const x = viewW>layout.width? (viewW - layout.width)/2 : 0; const y = viewH>layout.height? (viewH - layout.height)/2 : 0; return { x, y }; },[layout, viewport, scale]);
  if(!root || !layout) return <div className="card"><div style={{padding:8,fontSize:'.65rem'}}>Loading OSINT data...</div></div>;
  return <div className="card fade-in" style={{display:'flex', flexDirection:'column', height:'calc(100vh - 220px)', maxHeight:'none', overflow:'hidden'}}>
    <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap'}}>
      <h3 style={{margin:0, fontSize:'0.8rem'}}>OSINT Framework</h3>
      <div style={{display:'flex', gap:4}}>
        <button className={'btn '+(mode==='tree'?'accent':'')} style={{padding:'4px 10px', fontSize:'.55rem'}} onClick={()=>setMode('tree')}>Tree</button>
        <button className={'btn '+(mode==='radial'?'accent':'')} style={{padding:'4px 10px', fontSize:'.55rem'}} onClick={()=>setMode('radial')}>Radial</button>
      </div>
      {mode==='tree' && <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
        <button className='btn' style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=> setCollapsed(new Set())}>Expand All</button>
        <button className='btn' style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=>{ const all=new Set(); (function collect(n){ if(n.children&&n.children.length){ all.add(n.__id); n.children.forEach(collect);} })(root); setCollapsed(all); }}>Collapse All</button>
        <button className='btn' style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=> setScale(s=> Math.min(2.5, s+0.1))}>+</button>
        <button className='btn' style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=> setScale(s=> Math.max(0.2, s-0.1))}>−</button>
        <button className='btn' style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=> setScale(1)}>100%</button>
        <button className={'btn '+(fit?'accent':'')} style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=> setFit(f=>!f)}>{fit? 'Auto-Fit':'Manual'}</button>
      </div>}
      <div style={{marginLeft:'auto', fontSize:'.55rem', opacity:.7}}>Nodes: {layout.nodes.length}</div>
    </div>
    {mode==='tree' && <div ref={containerRef} style={{flex:1, overflow:'auto', border:'1px solid var(--border)', borderRadius:10, position:'relative', background:'linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))'}}>
      <div style={{width: Math.max(layout.width*scale, viewport.w), height: Math.max(layout.height*scale, viewport.h), position:'relative'}}>
        <svg width={layout.width} height={layout.height} style={{position:'absolute', top:0, left:0, transform:`translate(${offsets.x}px,${offsets.y}px) scale(${scale})`, transformOrigin:'top left', font:'11px Inter,system-ui'}}>
          <g fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1}>{layout.linkPaths.map((d,i)=><path key={i} d={d} />)}</g>
          {layout.nodes.map(o=>{ const n=o.n; const has=(n.children||[]).length>0; const isCol=collapsed.has(n.__id); return <g key={n.__id} transform={`translate(${o.x+layout.leftPad},${o.y+layout.topPad})`} style={{cursor: has? 'pointer': (n.url?'pointer':'default')}} onClick={()=> has? toggle(n): n.url && window.open(n.url,'_blank','noopener')}>
            <circle r={5} fill={has? '#5d7bff':'#38e8d2'} stroke="#2f3f5a" strokeWidth={1.2} />
            {has && <text x={-8} y={5} fontSize={11} fill={isCol? '#7aa2ff':'#38e8d2'} textAnchor='end'>{isCol? '+':'−'}</text>}
            <text x={10} y={4} fontSize={12} fill="#cbd5e1">{n.name}</text>
            {n.url && <text x={10} y={-6} fontSize={9} fill="#5d7bff">↗</text>}
          </g>; })}
        </svg>
      </div>
    </div>}
    {mode==='radial' && <div style={{flex:1, minHeight:500}}><RadialOSINT arf={root} collapsed={collapsed} setCollapsed={setCollapsed} /></div>}
  </div>;
}

function RadialOSINT({ arf, collapsed, setCollapsed }){
  const containerRef = useRef(null);
  const [hover,setHover] = useState(null);
  const TYPE_COLORS = { T:'#5d7bff', D:'#38e8d2', R:'#ff9f43', M:'#c14fff', default:'#18c978' };

  // ensure ids exist (mirrors tree attach)
  useEffect(()=>{
    function attach(n, path='root'){ n.__id = path; if(n.children) n.children.forEach(c=> attach(c, path+'/'+(c.name||Math.random().toString(36).slice(2)))); }
    attach(arf);
  },[arf]);

  // compute subtree sizes (only counting visible)
  const sizes = useMemo(()=>{
    function calc(n){ if(collapsed.has(n.__id) || !n.children || !n.children.length) return 1; return n.children.reduce((a,c)=> a+calc(c), 1); }
    return calc(arf);
  },[arf, collapsed]);

  // layout all visible nodes with proportional angles
  const layout = useMemo(()=>{
    const nodes=[]; const links=[]; const RING=70; const TWO_PI=Math.PI*2; const centerDepthOffset=1; // root at ring 0
    function subtreeCount(n){ if(collapsed.has(n.__id) || !n.children || !n.children.length) return 1; return n.children.reduce((a,c)=> a+subtreeCount(c),1); }
    const total = subtreeCount(arf);
    function place(n, depth, a0, a1, parent){
      const angle=(a0+a1)/2; const radius = depth*RING; const x=Math.cos(angle)*radius; const y=Math.sin(angle)*radius;
      const entry={ node:n, x,y, angle, depth }; nodes.push(entry); if(parent) links.push({ from:parent, to:entry });
      if(!collapsed.has(n.__id) && n.children && n.children.length){
        let acc=a0; const subtotal=subtreeCount(n); n.children.forEach(c=>{ const slice = (subtreeCount(c)/total)*TWO_PI* (subtotal/total? total/subtotal:1); // adjust within parent span
          const span = (subtreeCount(c)/subtotal)*(a1-a0); place(c, depth+1, acc, acc+span, entry); acc+=span; });
      }
    }
    place(arf,0,-Math.PI/2,-Math.PI/2+TWO_PI,null);
    return { nodes, links };
  },[arf, collapsed, sizes]);

  // redraw canvas
  useEffect(()=>{
    if(!containerRef.current) return; const el=containerRef.current; const canvas=el.querySelector('canvas'); if(!canvas) return; const ctx=canvas.getContext('2d');
    function draw(){ const w=el.clientWidth, h=el.clientHeight; canvas.width=w; canvas.height=h; ctx.clearRect(0,0,w,h); ctx.save(); ctx.translate(w/2,h/2);
      // links
      ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1; layout.links.forEach(l=>{ ctx.beginPath(); ctx.moveTo(l.from.x,l.from.y); ctx.lineTo(l.to.x,l.to.y); ctx.stroke(); });
      // nodes
      layout.nodes.forEach(o=>{ const n=o.node; const type=n.type||'default'; const color = TYPE_COLORS[type]||TYPE_COLORS.default; const hot = hover && hover.node===n; const r = n.children && n.children.length ? 11 : 7; ctx.beginPath(); ctx.fillStyle=color; ctx.globalAlpha = hot? .95 : (n.children && n.children.length ? .3:.55); ctx.arc(o.x,o.y, hot? r+2:r,0,Math.PI*2); ctx.fill(); if(hot){ ctx.globalAlpha=1; ctx.font='500 11px Inter'; ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillStyle='#e2e8f0'; ctx.fillText(n.name.slice(0,50), o.x, o.y-14); } });
      ctx.restore();
    }
    draw(); const ro=new ResizeObserver(draw); ro.observe(el); return ()=> ro.disconnect();
  },[layout, hover]);

  function pick(e){ const el=containerRef.current; if(!el) return; const rect=el.getBoundingClientRect(); const x=e.clientX-rect.left - rect.width/2; const y=e.clientY-rect.top - rect.height/2; let found=null; for(const o of layout.nodes){ const dx=o.x-x, dy=o.y-y; const rad = o.node.children && o.node.children.length? 13:9; if(dx*dx+dy*dy < rad*rad){ found=o; break; } } setHover(found); }
  function click(e){ if(!hover) return; const n=hover.node; if(n.children && n.children.length && !e.shiftKey){ setCollapsed(s=>{ const ns=new Set(s); if(ns.has(n.__id)) ns.delete(n.__id); else ns.add(n.__id); return ns; }); } else if(n.url){ window.open(n.url,'_blank','noopener'); } }
  function expandAll(){ setCollapsed(new Set()); }
  function collapseAll(){ const all=new Set(); function collect(n){ if(n.children && n.children.length){ all.add(n.__id); n.children.forEach(collect); } } collect(arf); setCollapsed(all); }

  return <div style={{flex:1, display:'flex', flexDirection:'column', minHeight:520}}>
    <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:6}}>
      <button className="btn" style={{padding:'4px 8px', fontSize:'.5rem'}} onClick={expandAll}>Expand All</button>
      <button className="btn" style={{padding:'4px 8px', fontSize:'.5rem'}} onClick={collapseAll}>Collapse All</button>
      <div style={{display:'flex', gap:10, flexWrap:'wrap', marginLeft:'auto'}}>
        {Object.entries(TYPE_COLORS).filter(([k])=>k!=='default').map(([k,v])=> <div key={k} style={{display:'flex', alignItems:'center', gap:4, fontSize:'.5rem', opacity:.75}}><span style={{width:10,height:10, background:v, borderRadius:4}}></span>{k}</div>)}
        <div style={{fontSize:'.5rem', opacity:.6}}>Click to expand/collapse • Shift+Click to open link</div>
      </div>
    </div>
    <div ref={containerRef} onMouseMove={pick} onMouseLeave={()=>setHover(null)} onClick={click} style={{flex:1, position:'relative', border:'1px solid var(--border)', borderRadius:10, background:'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05), transparent)'}}>
      <canvas style={{position:'absolute', inset:0, width:'100%', height:'100%'}} />
      {hover && <div style={{position:'absolute', left:(containerRef.current?.clientWidth||0)/2 + hover.x + 14, top:(containerRef.current?.clientHeight||0)/2 + hover.y + 14, background:'rgba(0,0,0,.55)', border:'1px solid var(--border)', padding:'6px 8px', borderRadius:8, fontSize:'.55rem', pointerEvents:'none', maxWidth:240}}>
        <div style={{fontWeight:600, fontSize:'.6rem'}}>{hover.node.name}</div>
        {hover.node.url && <div style={{opacity:.75}}>{hover.node.url.replace(/^https?:\/\//,'')}</div>}
        {hover.node.children && hover.node.children.length>0 && <div style={{marginTop:4, opacity:.65}}>{hover.node.children.length} children</div>}
        <div style={{marginTop:6, opacity:.5}}>{collapsed.has(hover.node.__id)? 'Collapsed':'Expanded'}{hover.node.url && ' • Shift+Click opens'}</div>
      </div>}
    </div>
  </div>;
}
