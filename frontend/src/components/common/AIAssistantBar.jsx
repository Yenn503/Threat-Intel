import React, { useEffect, useState, useRef } from 'react';
import { safeFetch } from '../../config/api.js';
import { useServerHealth } from '../providers/ServerHealthProvider.jsx';

export default function AIAssistantBar({ token }){
  const { serverDown, markSuccess, markFailure } = useServerHealth();
  const [open,setOpen] = useState(false);
  const [input,setInput] = useState('');
  const [history,setHistory] = useState([]);
  const [loading,setLoading] = useState(false);
  const [agentInstruction,setAgentInstruction] = useState('scan & summarize scanme.nmap.org');
  const [tasks,setTasks] = useState([]);
  const boxRef = useRef(null);

  useEffect(()=>{ if(!token||serverDown) return; (async()=>{ try { const d=await safeFetch('/api/ai/history',{ token }); if(d.ok){ setHistory(d.history); markSuccess(); } } catch { markFailure(); } })(); fetchTasks(); },[token, serverDown]);
  function fetchTasks(){ if(!token||serverDown) return; (async()=>{ try { const d=await safeFetch('/api/ai/agent/tasks',{ token }); if(d.ok){ setTasks(d.tasks); markSuccess(); } } catch { markFailure(); } })(); }
  useEffect(()=>{ if(!open) return; let id; let fail=0; const loop=()=>{ if(serverDown){ id=setTimeout(loop, 10000); return; } fetchTasks(); fail=0; id=setTimeout(loop,4000); }; loop(); return ()=> clearTimeout(id); },[open, token, serverDown]);
  useEffect(()=>{ function key(e){ if(e.ctrlKey && e.key.toLowerCase()==='/'){ e.preventDefault(); setOpen(o=>!o); if(!open) setTimeout(()=> boxRef.current?.focus(), 30); } } window.addEventListener('keydown', key); return ()=> window.removeEventListener('keydown', key); },[open]);

  function send(){ if(!input.trim()||loading||serverDown) return; const msg = input.trim(); setLoading(true); setInput(''); safeFetch('/api/ai/chat',{ method:'POST', token, body: JSON.stringify({ message: msg }) }).then(d=>{ if(d.ok){ setHistory(d.history); markSuccess(); } }).catch(()=> markFailure()).finally(()=> setLoading(false)); }
  function onKey(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } }

  return (
    <div style={{position:'fixed', left:0, right:0, bottom:0, zIndex:4000, pointerEvents:'none'}}>
      <div style={{maxWidth:960, margin:'0 auto', padding:'0 16px 18px', display: open? 'block':'none'}}>
        <div className="card" style={{background:'rgba(16,22,32,.9)', backdropFilter:'blur(8px)', borderRadius:18, padding:18, pointerEvents:'auto', boxShadow:'0 12px 40px -10px rgba(0,0,0,.6)'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
            <div style={{fontSize:'.65rem', letterSpacing:'.5px', fontWeight:600}}>AI ASSISTANT <span style={{opacity:.5}}> (CTRL + / to toggle)</span></div>
            <button className="btn" style={{padding:'4px 10px', fontSize:'.55rem'}} onClick={()=> setOpen(false)}>Close</button>
          </div>
          <div className="table-scroll" style={{maxHeight:200, marginBottom:10, fontSize:'.62rem'}}>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {history.map((m,i)=> <div key={i} style={{alignSelf: m.role==='user'?'flex-end':'flex-start', background: m.role==='user'? 'var(--accent)':'#1d2633', color:m.role==='user'? '#fff':'var(--text)', padding:'6px 10px', borderRadius:10, maxWidth:'80%', whiteSpace:'pre-wrap'}}>{m.content}</div>)}
              {history.length===0 && <div style={{fontSize:'.6rem', opacity:.6}}>Start by asking: "last nmap"</div>}
            </div>
          </div>
          <div style={{display:'flex', gap:8}}>
            <textarea ref={boxRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKey} placeholder="Ask about scans, e.g., 'last nmap' or 'scan target 10.0.0.5 with nmap -F'" style={{flex:1, resize:'none', fontSize:'.65rem', lineHeight:1.4, padding:'10px 12px', borderRadius:12, background:'#0e1622', border:'1px solid #253344', color:'var(--text)', minHeight:52}} />
            <button className="btn accent" disabled={loading} onClick={send} style={{alignSelf:'flex-end', padding:'10px 16px', fontSize:'.6rem'}}>{loading? '...' : 'Send'}</button>
          </div>
          <div style={{marginTop:14, display:'flex', flexDirection:'column', gap:6}}>
            <div style={{fontSize:'.55rem', fontWeight:600, letterSpacing:'.5px'}}>AGENT TASK</div>
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              <input value={agentInstruction} onChange={e=>setAgentInstruction(e.target.value)} style={{flex:'1 1 260px'}} placeholder="scan & summarize host" />
              <button className="btn" style={{fontSize:'.6rem'}} onClick={()=>{
                if(!agentInstruction.trim()||serverDown) return; safeFetch('/api/ai/agent/tasks',{ method:'POST', token, body: JSON.stringify({ instruction: agentInstruction.trim() }) }).then(d=>{ if(d.ok){ fetchTasks(); markSuccess(); } }).catch(()=> markFailure());
              }}>Queue</button>
            </div>
            <div className="table-scroll" style={{maxHeight:140}}>
              <table><thead><tr><th style={{width:90}}>Status</th><th>Instruction</th><th style={{width:120}}>Created</th></tr></thead><tbody>
                {tasks.map(t=> <tr key={t.id}><td>{t.status}</td><td style={{whiteSpace:'nowrap', maxWidth:240, overflow:'hidden', textOverflow:'ellipsis'}}>{t.instruction}</td><td>{new Date(t.created_at).toLocaleTimeString()}</td></tr>)}
                {tasks.length===0 && <tr><td colSpan={3} style={{fontSize:'.6rem', opacity:.6}}>No tasks.</td></tr>}
              </tbody></table>
            </div>
          </div>
        </div>
      </div>
      {!open && token && <div style={{pointerEvents:'auto', maxWidth:960, margin:'0 auto', padding:'0 16px 18px'}}>
        <button onClick={()=> setOpen(true)} className="btn accent" style={{borderRadius:22, fontSize:'.6rem', padding:'10px 18px', boxShadow:'0 8px 28px -8px rgba(0,0,0,.55)'}}>AI Assistant (CTRL + /)</button>
      </div>}
    </div>
  );
}
