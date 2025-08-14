import React, { useState, useRef, useEffect } from 'react';
import { useToast } from '../providers/ToastProvider.jsx';

// Extracted DBSearch panel (HIBP email lookup)
export default function DBSearch({ token, active }){
  const initialRef = useRef(null);
  if(initialRef.current===null){
    try { initialRef.current = JSON.parse(localStorage.getItem('ti_dbsearch_state')) || {}; } catch { initialRef.current = {}; }
  }
  const [mode,setMode] = useState(initialRef.current.mode || 'single');
  const [emailsInput, setEmailsInput] = useState(initialRef.current.emailsInput || '');
  const [results, setResults] = useState(initialRef.current.results || {});
  const [queue,setQueue] = useState([]);
  const [inFlight,setInFlight] = useState(false);
  const [progress,setProgress] = useState(initialRef.current.progress || { done:0, total:0 });
  const [stats,setStats] = useState(initialRef.current.stats || { breached:0, clear:0, errors:0 });
  const [config,setConfig] = useState({ perMinute:10, batchLimit:10 });
  const [presets,setPresets] = useState(()=>{ try { return JSON.parse(localStorage.getItem('ti_db_presets'))||[]; } catch { return []; } });
  const cancelRef = useRef(false);
  const fileInputRef = useRef(null);
  const progressToastRef = useRef(null);
  const toast = useToast();

  useEffect(()=>{ try { localStorage.setItem('ti_dbsearch_state', JSON.stringify({ mode, emailsInput, results, progress, stats })); } catch {} }, [mode, emailsInput, results, progress, stats]);
  useEffect(()=>{ fetch('http://localhost:4000/api/hibp/config',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(c=>setConfig(c)).catch(()=>{}); },[token]);

  function parseEmails(raw){ return (raw ?? emailsInput).split(/[\n,; ]+/).map(s=>s.trim().toLowerCase()).filter((v,i,a)=>v && a.indexOf(v)===i); }
  function savePreset(){ const list = parseEmails(); if(!list.length) return; const name = prompt('Preset name'); if(!name) return; const next = [...presets.filter(p=>p.name!==name), { name, emails:list }]; setPresets(next); try { localStorage.setItem('ti_db_presets', JSON.stringify(next)); } catch {} }
  function loadPreset(p){ setEmailsInput(p.emails.join('\n')); }

  async function runSingle(){
    const list = parseEmails(); if(!list.length) return;
    setInFlight(true); cancelRef.current=false; setResults({}); setProgress({done:0,total:list.length}); setStats({breached:0,clear:0,errors:0});
    progressToastRef.current = toast.info(`HIBP: 0/${list.length} (0%)`, { ttl:0 });
    const chunks=[]; for(let i=0;i<list.length;i+=config.batchLimit) chunks.push(list.slice(i,i+config.batchLimit));
    for(const chunk of chunks){ if(cancelRef.current) break; await fireRequest(chunk); await delay((60_000 / config.perMinute)); updateProgressToast(); }
    setInFlight(false); finalizeProgressToast();
  }
  async function runBatch(){
    const list = parseEmails(); if(!list.length) return; if(list.length>1000){ alert('Batch mode capped at 1000 emails for this UI export.'); return; }
    setInFlight(true); cancelRef.current=false; setResults({}); setProgress({done:0,total:list.length}); setStats({breached:0,clear:0,errors:0});
    const queueLocal=[...list]; setQueue(queueLocal); const intervalMs=Math.ceil(60_000 / config.perMinute);
    progressToastRef.current = toast.info(`HIBP: 0/${queueLocal.length} (0%)`, { ttl:0 });
    for(let i=0;i<queueLocal.length;i++){ if(cancelRef.current) break; const email=queueLocal[i]; await fireRequest([email]); updateProgressToast(); if(i<queueLocal.length-1) await delay(intervalMs); }
    setInFlight(false); finalizeProgressToast();
  }
  async function fireRequest(emails){
    try { const r = await fetch('http://localhost:4000/api/hibp/search', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body: JSON.stringify({ emails }) }); const data = await r.json(); const res=data.results||{}; setResults(prev=>({...prev,...res})); let breached=0, clear=0, errors=0; Object.entries(res).forEach(([email,val])=>{ if(Array.isArray(val)){ if(val.length) breached++; else clear++; } else errors++; }); setStats(s=>({ breached: s.breached+breached, clear: s.clear+clear, errors: s.errors+errors })); } catch(e){ setResults(prev=>({...prev,...Object.fromEntries(emails.map(ea=>[ea,{ error:e.message }]))})); setStats(s=>({ ...s, errors: s.errors + emails.length })); toast.error('Lookup failed for '+emails.length+' email(s)'); } finally { setProgress(p=>({ done: Math.min(p.done + emails.length, p.total), total: p.total })); }
  }
  function updateProgressToast(){ if(!progressToastRef.current) return; const pct = progress.total ? Math.round((progress.done/progress.total)*100) : 0; toast.update(progressToastRef.current, `HIBP: ${progress.done}/${progress.total} (${pct}%)`); }
  function finalizeProgressToast(){ if(!progressToastRef.current) return; const { breached, clear, errors } = stats; toast.update(progressToastRef.current, `HIBP complete • ${breached} breached / ${clear} clear / ${errors} errors`, { ttl: 5000, type: errors? 'error': 'success' }); progressToastRef.current = null; }
  function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function cancel(){ cancelRef.current=true; setInFlight(false); }
  function reset(){ setEmailsInput(''); setResults({}); setProgress({done:0,total:0}); setStats({breached:0,clear:0,errors:0}); cancelRef.current=true; setInFlight(false); }
  function triggerImport(){ if(inFlight) return; fileInputRef.current?.click(); }
  function handleFile(e){ const file = e.target.files?.[0]; if(!file) return; const reader = new FileReader(); reader.onload = () => { const text = reader.result || ''; const imported = parseEmails(String(text)); const existing = parseEmails(); const merged = [...new Set([...existing, ...imported])]; setEmailsInput(merged.join('\n')); }; reader.readAsText(file); e.target.value=''; }
  function exportJSON(){ const payload = Object.entries(results).map(([email,val])=>({ email, status: Array.isArray(val)? (val.length? 'breached':'clear'):'error', breaches: Array.isArray(val)? val:[], error: Array.isArray(val)? null: val.error || 'error' })); downloadBlob(JSON.stringify(payload,null,2), 'hibp_results.json', 'application/json'); }
  function exportCSV(){ const header = ['email','status','breach_count','breach_names','error']; const rows = Object.entries(results).map(([email,val])=>{ if(Array.isArray(val)){ const names = val.map(b=>b.Name).join(';'); return [email, val.length? 'breached':'clear', val.length, '"'+names.replace(/"/g,'""')+'"','']; } else { return [email,'error',0,'', '"'+(val.error||'').replace(/"/g,'""')+'"']; }}); const csv=[header.join(','), ...rows.map(r=>r.join(','))].join('\n'); downloadBlob(csv,'hibp_results.csv','text/csv'); }
  function downloadBlob(content, filename, type){ const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),2000); }
  const percent = progress.total ? Math.round((progress.done/progress.total)*100) : 0; const firstStartRef = useRef(null); if(progress.total && progress.done && !firstStartRef.current){ firstStartRef.current = Date.now(); }
  let etaText=''; if(firstStartRef.current && progress.done>0 && progress.done < progress.total){ const elapsed=(Date.now()-firstStartRef.current)/1000; const perItem=elapsed/progress.done; const remaining = perItem * (progress.total - progress.done); const mins=Math.floor(remaining/60); const secs=Math.round(remaining % 60); etaText = 'ETA '+ (mins>0? mins+'m ':'') + secs + 's'; } else if(progress.done && progress.done===progress.total && firstStartRef.current){ const totalSec=(Date.now()-firstStartRef.current)/1000; etaText = 'Completed in '+ totalSec.toFixed(1)+'s'; }
  if(!active) return <div style={{display:'none'}} aria-hidden="true" />;
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
  </div>;
}
