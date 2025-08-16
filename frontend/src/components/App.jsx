import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FiHome, FiCpu, FiTerminal, FiCode, FiDatabase, FiShield, FiSettings, FiGlobe } from 'react-icons/fi';
import Dashboard from './panels/Dashboard.jsx';
import AgentPanel from './panels/Agent/AgentPanel.jsx';
import ExploitPanel from './panels/ExploitPanel.jsx';
import OSINTPanel from './panels/OSINTPanel.jsx';
import ConsolePanel from './panels/ConsolePanel.jsx';
import CodeEditor from './panels/CodeEditor.jsx';
import DBSearch from './panels/DBSearch.jsx';
import VulnSearch from './panels/VulnSearch.jsx';
import FSWA from './panels/FSWA.jsx';
import NetworkVA from './panels/NetworkVA.jsx';
import DigitalFootprint from './panels/DigitalFootprint.jsx';
import CyberRiskExposure from './panels/CyberRiskExposure.jsx';
import Settings from './panels/Settings.jsx';
import AdminPanel from './panels/AdminPanel.jsx';
import CommandPalette from './common/CommandPalette.jsx';
import { ToastProvider, useToast } from './providers/ToastProvider.jsx';
import PanelErrorBoundary from './common/PanelErrorBoundary.jsx';

// Panel order & grouping definitions for sidebar rendering
const panels = [ 'Dashboard','Agents','Exploits','OSINT','Console','Code Editor','DB Search','Vuln Search','FSWA','Network VA','Digital Footprint','Cyber Risk Exposure','Admin','Settings' ];
// Sidebar groups (System rendered separately, pinned bottom)
const panelGroups = [
  { label:'Core', items:['Dashboard','Agents','Exploits','OSINT'] },
  { label:'Tools', items:['Console','Code Editor'] },
  { label:'Databases', items:['DB Search','Vuln Search'] },
  { label:'Assessments', items:['FSWA','Network VA','Digital Footprint','Cyber Risk Exposure'] }
];
const panelIcons = {
  'Dashboard': <FiHome size={14}/>,'Agents': <FiCpu size={14}/>,'Exploits': <FiCpu size={14}/>,'OSINT': <FiGlobe size={14}/>,'Console': <FiTerminal size={14}/>,'Code Editor': <FiCode size={14}/>,'DB Search': <FiDatabase size={14}/>,'Vuln Search': <FiShield size={14}/>,'FSWA': <FiShield size={14}/>,'Network VA': <FiShield size={14}/>,'Digital Footprint': <FiGlobe size={14}/>,'Cyber Risk Exposure': <FiShield size={14}/>,'Admin': <FiSettings size={14}/>,'Settings': <FiSettings size={14}/>
};

function AppShell(){
  const [active, setActive] = useState(()=> localStorage.getItem('ti_active_panel') || 'Dashboard');
  const [token, setToken] = useState(null);
  const [techniquesMeta,setTechniquesMeta] = useState([]);
  const [theme,setTheme] = useState(()=> localStorage.getItem('ti_theme') || (window.matchMedia('(prefers-color-scheme: light)').matches? 'light':'dark'));
  const [consoleState, setConsoleState] = useState({ buffer:'', inputLine:'' });
  const [commandOpen,setCommandOpen] = useState(false);
  const [commandQuery,setCommandQuery] = useState('');
  const wsRef = useRef(null);
  const [consoleConnected, setConsoleConnected] = useState(false);

  useEffect(()=>{ document.documentElement.classList.toggle('light', theme==='light'); localStorage.setItem('ti_theme', theme); },[theme]);
  useEffect(()=>{ if(localStorage.getItem('ti_theme')) return; const mq = window.matchMedia('(prefers-color-scheme: light)'); const handler = e=> setTheme(e.matches? 'light':'dark'); mq.addEventListener('change', handler); return ()=> mq.removeEventListener('change', handler); },[]);
  useEffect(()=>{ localStorage.setItem('ti_active_panel', active); },[active]);
  useEffect(()=>{ function onKey(e){ if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='t'){ setTheme(t=> t==='dark'?'light':'dark'); e.preventDefault(); } } window.addEventListener('keydown', onKey); return ()=> window.removeEventListener('keydown', onKey); },[]);
  useEffect(()=>{ function onKey(e){ if(e.ctrlKey && !e.shiftKey && e.key.toLowerCase()==='k'){ e.preventDefault(); setCommandOpen(o=>!o); setCommandQuery(''); } } window.addEventListener('keydown',onKey); return ()=> window.removeEventListener('keydown',onKey); },[]);

  useEffect(()=>{ if(!token){ setTechniquesMeta([]); return; } fetch('http://localhost:4000/api/techniques').then(r=>r.json()).then(d=> setTechniquesMeta(d.techniques||[])).catch(()=>{}); },[token]);
  useEffect(()=>{ function key(e){ if(e.ctrlKey && e.altKey && (e.key==='ArrowRight' || e.key==='ArrowLeft')){ e.preventDefault(); const idx = panels.indexOf(active); if(idx!==-1){ const next = e.key==='ArrowRight'? (idx+1)%panels.length : (idx-1+panels.length)%panels.length; setActive(panels[next]); } } } window.addEventListener('keydown', key); return ()=> window.removeEventListener('keydown', key); },[active]);

  useEffect(()=>{
    if(!token){ if(wsRef.current){ wsRef.current.close(); wsRef.current=null; setConsoleConnected(false);} return; }
    if(wsRef.current) return;
    const ws = new WebSocket(`ws://localhost:4000/api/terminal?token=${token}`);
    wsRef.current = ws;
    ws.onopen = ()=> setConsoleConnected(true);
    ws.onclose = ()=> { setConsoleConnected(false); wsRef.current=null; };
    ws.onmessage = ev => { try { const msg = JSON.parse(ev.data); if(msg.type==='data'){ setConsoleState(s => ({...s, buffer: s.buffer + msg.data })); } } catch{} };
    return ()=> ws.close();
  },[token]);

  function sendConsole(data){ if(wsRef.current) wsRef.current.send(JSON.stringify({ type:'stdin', data })); }
  function logout(){ setToken(null); setConsoleState({ buffer:'', inputLine:'' }); }
  useEffect(()=>{ if(token){ setConsoleState({ buffer:'', inputLine:'' }); } },[token]);

  const commandItems = useMemo(()=>[
    ...panels.map(p=> ({ group:'Panels', label:p, action:()=> setActive(p) })),
    { group:'Theme', label:'Toggle Theme', action:()=> setTheme(t=> t==='dark'?'light':'dark') },
    { group:'Actions', label:'Open Console', action:()=> setActive('Console') },
    { group:'Actions', label:'New Technique', action:()=> setActive('Exploits') },
    ...techniquesMeta.map(t=> ({ group:'Techniques', label:`${t.category}: ${t.name}`, action:()=> { localStorage.setItem('ti_select_tech_id', String(t.id)); setActive('Exploits'); } })),
    ...(()=>{ try { const fs = JSON.parse(localStorage.getItem('ti_editor_files'))||[]; return fs.map(f=> ({ group:'Files', label:'Open File: '+f.name, action:()=> { localStorage.setItem('ti_editor_active', f.id); setActive('Code Editor'); } })); } catch { return []; } })()
  ],[techniquesMeta, setActive]);
  const filteredCommands = commandItems.filter(c=> c.label.toLowerCase().includes(commandQuery.toLowerCase()));

  return (
    <ToastProvider>
      <div className="sidebar">
        <div className="brand"><div className="brand-logo">TI</div><h1>Threat‑Intel</h1></div>
        <div className="nav" style={{display:'flex', flexDirection:'column', height:'100%'}}>
          <div style={{flex:1, display:'flex', flexDirection:'column', overflowY:'auto', paddingBottom:8}}>
            {panelGroups.map(g => (
              <div key={g.label} style={{display:'flex', flexDirection:'column', gap:6, marginBottom:20}}>
                <div style={{fontSize:'.7rem', fontWeight:600, letterSpacing:'.5px', opacity:.85, padding:'6px 6px 6px', position:'relative'}}>
                  {g.label}
                  <div style={{position:'absolute', left:6, right:6, bottom:0, height:1, background:'linear-gradient(90deg,rgba(255,255,255,0.18),rgba(255,255,255,0.04))'}} />
                </div>
                {g.items.map(p => (
                  <button key={p} onClick={()=>setActive(p)} className={"nav-button "+(active===p?'active':'')}>{panelIcons[p]} <span>{p}</span></button>
                ))}
              </div>
            ))}
          </div>
          {/* Pinned bottom system section matching underline style */}
          <div style={{display:'flex', flexDirection:'column', gap:6, paddingBottom:4, marginTop:4}}>
            <div style={{fontSize:'.7rem', fontWeight:600, letterSpacing:'.5px', opacity:.85, padding:'6px 6px 6px', position:'relative'}}>
              System
              <div style={{position:'absolute', left:6, right:6, bottom:0, height:1, background:'linear-gradient(90deg,rgba(255,255,255,0.18),rgba(255,255,255,0.04))'}} />
            </div>
            {['Admin','Settings'].map(p => (
              <button key={p} onClick={()=>setActive(p)} className={"nav-button "+(active===p?'active':'')}>{panelIcons[p]} <span>{p}</span></button>
            ))}
            <div className="nav-footer" style={{marginTop:6}}>v0.3.0 • {token? 'AUTH':'GUEST'}</div>
          </div>
        </div>
      </div>
      <div className="content">
        <div className="app-header"><h2>{active}</h2><div className={"status-pill "+(token?'online':'')}>{token? 'Logged In':'Not Authenticated'}</div></div>
        <main>
          <div className={"center-wrap fade-in" + (active==='FSWA' ? ' wide' : '')}>
            {!token && active !== 'Settings' && <Auth setToken={setToken} />}
            {token && active==='Dashboard' && <Dashboard token={token} setActive={setActive} consoleState={consoleState} />}
            {token && active==='Agents' && <AgentPanel token={token} />}
            {token && active==='Exploits' && <ExploitPanel token={token} />}
            {token && active==='OSINT' && <OSINTPanel token={token} />}
            {token && <ConsolePanel active={active==='Console'} consoleState={consoleState} setConsoleState={setConsoleState} sendConsole={sendConsole} connected={consoleConnected} />}
            {token && active==='Code Editor' && <PanelErrorBoundary><CodeEditor theme={theme} /></PanelErrorBoundary>}
            {token && <DBSearch token={token} active={active==='DB Search'} />}
            {token && <FSWA token={token} active={active==='FSWA'} />}
            {token && <NetworkVA token={token} active={active==='Network VA'} />}
            {token && <DigitalFootprint token={token} active={active==='Digital Footprint'} />}
            {token && <CyberRiskExposure token={token} active={active==='Cyber Risk Exposure'} />}
            {token && <VulnSearch token={token} active={active==='Vuln Search'} />}
            {active==='Admin' && <AdminPanel token={token} />}
            {active==='Settings' && <Settings token={token} setToken={setToken} logout={logout} theme={theme} setTheme={setTheme} />}
          </div>
        </main>
      </div>
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
      const data = await r.json(); if(!r.ok){ setError(data.error||'Login failed'); toast.error(data.error||'Login failed'); return; }
      setToken(data.token); toast.success('Welcome back');
    } catch(e){ setError(e.message); toast.error(e.message); }
  }
  return (<div className="auth-shell">
    <div className="auth-hero"><div className="logo-orb">TI</div><h1>Threat‑Intel Operator Console</h1><p className="tagline">Enumerate. Exploit. Evolve.</p></div>
    <div className="auth-panel pop-in"><h2>Sign In</h2><div className="form-group"><label>Email</label><input autoFocus value={email} onChange={e=>setEmail(e.target.value)} /></div><div className="form-group"><label>Password</label><input value={password} type="password" onChange={e=>setPassword(e.target.value)} /></div><button className="btn accent full" onClick={login}>Enter Console</button>{error && <div className="form-error">{error}</div>}</div>
  </div>);
}

export default AppShell;
