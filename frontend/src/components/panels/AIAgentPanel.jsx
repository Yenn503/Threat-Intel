import React, { useState, useEffect, useRef } from 'react';
// DEPRECATION NOTICE: This legacy AIAgentPanel is slated for removal after full
// parity is confirmed in UnifiedAIAgent. New features should target UnifiedAIAgent.
// Network calls will gradually be migrated to the central api/* modules.
import { getAgentTools, getAgentHealth, listAgentTasks, agentChat, agentExecute } from '../../api/agent';
import { getBinaries } from '../../api/scans';

export default function AIAgentPanel({ token, active }){
  const [messages,setMessages] = useState([]); // {role:'user'|'assistant', content:string}
  const [input,setInput] = useState('Recon scanme.nmap.org and summarize');
  const [sending,setSending] = useState(false);
  const [tasks,setTasks] = useState([]);
  const [tools,setTools] = useState([]);
  const [autoPlan,setAutoPlan] = useState(false); // default off to avoid surprise auto-execution
  const [lastSuggestedPlan,setLastSuggestedPlan] = useState([]);
  const [llmReady,setLlmReady] = useState(true);
  const [binaries,setBinaries] = useState(null); // { nmap: {ok,...}, nuclei: {ok,...} }
  const bottomRef = useRef(null);

  useEffect(()=>{ if(!token) return; getAgentTools(token).then(res=>{ if(res.ok && res.data?.ok) setTools(res.data.tools); }); },[token]);
  useEffect(()=>{ if(!token) return; getAgentHealth(token).then(res=>{ if(res.ok && res.data?.ok) setLlmReady(!!res.data.llm); }); },[token]);
  // Adaptive polling: faster while active tasks running, slower when idle
  // Agent tasks polling (avoid effect re-instantiation on each tasks change)
  useEffect(()=>{ if(!active||!token) return; let timer; let backoff=0; let stopped=false;
    const poll=()=>{
      listAgentTasks(token)
        .then(res=>{
          if(!res.ok) { backoff=Math.min(30000,(backoff||2000)*2); return; }
          const d = res.data;
          if(d && d.ok && Array.isArray(d.tasks)){
            const map = new Map(); d.tasks.forEach(t=> map.set(t.id,t));
            const cleaned = Array.from(map.values()).sort((a,b)=> b.created_at - a.created_at).slice(0,50);
            setTasks(prev=>{
              if(prev.length===cleaned.length && prev.every((p,i)=> p.id===cleaned[i].id && p.status===cleaned[i].status && p.updated_at===cleaned[i].updated_at)) return prev;
              return cleaned;
            });
            const running = cleaned.some(t=> ['pending','running','waiting','queued'].includes(t.status));
            const base = running? 3000: 8000;
            backoff=0;
            timer = setTimeout(poll, backoff || base);
          } else {
            timer = setTimeout(poll, backoff || 8000);
          }
        })
        .catch(()=>{ backoff=Math.min(30000,(backoff||2000)*2); timer = setTimeout(poll, backoff); });
    };
    poll();
    return ()=> { stopped=true; clearTimeout(timer); };
  },[active, token]);

  // Binary availability (nmap / nuclei) check every 30s while panel visible
  useEffect(()=>{ if(!active||!token) return; let id; const load=()=>{ getBinaries(token).then(res=>{ if(res.ok && res.data?.ok) setBinaries(res.data.binaries); }); id=setTimeout(load,30000); }; load(); return ()=> clearTimeout(id); },[active, token]);
  useEffect(()=>{ bottomRef.current?.scrollIntoView({ behavior:'smooth' }); },[messages, active]);

  function send(){ if(!input.trim()||sending) return; const prompt = input.trim(); setSending(true); setInput(''); setMessages(m=> [...m, { role:'user', content: prompt }]); agentChat(token,{ prompt, autoplan:autoPlan })
    .then(res=>{ if(res.ok && res.data?.ok){ const d=res.data; const reply=d.reply; setMessages(m=> [...m, { role:'assistant', content: reply }]); if(d.plan && !d.executed){ setLastSuggestedPlan(d.plan); } else setLastSuggestedPlan([]); } else { setMessages(m=> [...m, { role:'assistant', content: res.error || res.data?.error || 'Error' }]); } })
    .catch(e=> setMessages(m=> [...m, { role:'assistant', content: e.message }] ))
    .finally(()=> setSending(false)); }

  function executeSuggested(){ if(!lastSuggestedPlan.length||sending) return; setSending(true); const instruction = messages.slice().reverse().find(m=> m.role==='user')?.content || 'agent task'; agentExecute(token,{ instruction, plan: lastSuggestedPlan })
    .then(res=>{ if(res.ok && res.data?.ok){ setMessages(m=> [...m, { role:'assistant', content: `Executing suggested plan (${lastSuggestedPlan.length} steps).` }]); setLastSuggestedPlan([]); } })
    .finally(()=> setSending(false)); }
  function onKey(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } }

  return (
    <div style={{display: active? 'flex':'none', flexDirection:'column', gap:16}}>
      <div className="card" style={{padding:16, display:'flex', flexDirection:'column', height:480}}>
        <div style={{fontSize:'.7rem', fontWeight:600, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <span>AI Agent Chat</span>
          {binaries && <span style={{fontSize:'.5rem', opacity:.7}}>
            nmap: <strong style={{color: binaries.nmap?.ok? '#5fbf60':'#bf5f5f'}}>{binaries.nmap?.ok? 'ok':'missing'}</strong> | nuclei: <strong style={{color: binaries.nuclei?.ok? '#5fbf5f':'#bf5f5f'}}>{binaries.nuclei?.ok? 'ok':'missing'}</strong>
          </span>}
        </div>
        {!llmReady && <div style={{background:'#402020', color:'#f6d6d6', padding:'6px 10px', borderRadius:8, fontSize:'.55rem', marginBottom:8}}>
          LLM disabled: set GEMINI_API_KEY in backend .env and restart server.
        </div>}
        <div className="table-scroll" style={{flex:1, overflowY:'auto', paddingRight:4, display:'flex', flexDirection:'column', gap:10}}>
          {messages.map((m,i)=> <div key={i} style={{alignSelf: m.role==='user'?'flex-end':'flex-start', background: m.role==='user'? 'var(--accent)':'#16202c', color:m.role==='user'? '#fff':'var(--text)', padding:'8px 12px', borderRadius:14, maxWidth:'70%', fontSize:'.65rem', whiteSpace:'pre-wrap', boxShadow:'0 2px 6px rgba(0,0,0,.25)'}}>{m.content}</div>)}
          {!messages.length && <div style={{fontSize:'.6rem', opacity:.6}}>Ask me to enumerate a host or analyze latest findings. Example: "Scan and assess scanme.nmap.org"</div>}
          <div ref={bottomRef} />
        </div>
        <div style={{display:'flex', gap:8, marginTop:8, alignItems:'flex-end'}}>
          <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKey} placeholder="Type a security objective or question..." style={{flex:1, minHeight:60, resize:'none'}} />
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            <button className="btn accent" disabled={sending} onClick={send} style={{height:34, minWidth:90}}>{sending? '...' : 'Send'}</button>
            <label style={{fontSize:'.5rem', display:'flex', gap:4, alignItems:'center'}}>
              <input type="checkbox" checked={autoPlan} onChange={e=> setAutoPlan(e.target.checked)} /> Auto Plan
            </label>
          </div>
        </div>
        {lastSuggestedPlan.length>0 && <div style={{marginTop:10, background:'#101a24', padding:10, borderRadius:10}}>
          <div style={{fontSize:'.6rem', fontWeight:600, marginBottom:4}}>Suggested Plan ({lastSuggestedPlan.length} step{lastSuggestedPlan.length>1?'s':''})</div>
          <ol style={{fontSize:'.55rem', paddingLeft:18, margin:0}}>{lastSuggestedPlan.map((s,i)=> <li key={i}><code>{s.tool}</code> {s.args? JSON.stringify(s.args):''}</li>)}</ol>
          <div style={{marginTop:6, display:'flex', gap:8}}>
            <button className="btn" style={{fontSize:'.55rem'}} onClick={executeSuggested}>Execute Plan</button>
            <button className="btn" style={{fontSize:'.55rem'}} onClick={()=> setLastSuggestedPlan([])}>Dismiss</button>
          </div>
        </div>}
        <div style={{marginTop:10, display:'flex', flexWrap:'wrap', gap:6}}>
          {tools.slice(0,8).map(t=> <span key={t.id} style={{fontSize:'.5rem', background:'#101a24', padding:'4px 8px', borderRadius:20}}>{t.id}</span>)}
        </div>
      </div>
      <div style={{display:'grid', gap:16, gridTemplateColumns:'1fr 1fr'}}>
        <div className="card" style={{padding:16}}>
          <div style={{fontSize:'.7rem', fontWeight:600, marginBottom:8}}>Active / Recent Tasks</div>
          <div className="table-scroll" style={{maxHeight:260}}>
            <table style={{fontSize:'.6rem'}}><thead><tr><th style={{width:70}}>Status</th><th>Instruction</th><th style={{width:80}}>Updated</th></tr></thead><tbody>
              {tasks.map(t=> <tr key={t.id} title={t.instruction}><td>{t.status}</td><td style={{maxWidth:200, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{t.instruction}</td><td>{new Date(t.updated_at).toLocaleTimeString()}</td></tr>)}
              {!tasks.length && <tr><td colSpan={3} style={{opacity:.6}}>None</td></tr>}
            </tbody></table>
          </div>
        </div>
        <div className="card" style={{padding:16}}>
          <div style={{fontSize:'.7rem', fontWeight:600, marginBottom:8}}>Tool Catalog</div>
          <ul style={{margin:0, paddingLeft:18, fontSize:'.6rem', lineHeight:1.4}}>
            {tools.map(t=> <li key={t.id}><code>{t.id}</code>: {t.description}</li>)}
            {!tools.length && <li>Loading…</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
