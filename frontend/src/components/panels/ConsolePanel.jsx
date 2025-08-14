import React, { useRef, useEffect } from 'react';
// Path: panels -> components -> src. utils is at src/utils/ansi.js so go up two levels
import { ansiToHtml, escapeHtml } from '../../utils/ansi.js';

// ConsolePanel replicates original behavior: stays mounted (hidden) to preserve session
export default function ConsolePanel({ active, consoleState, setConsoleState, sendConsole, connected }){
  if(!consoleState) return null;
  const { buffer, inputLine } = consoleState;
  const termRef = useRef(null);
  const historyRef = useRef([]); // newest first
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
