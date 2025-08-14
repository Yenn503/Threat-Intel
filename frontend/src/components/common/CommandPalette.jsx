import React, { useEffect } from 'react';
export default function CommandPalette({ query, setQuery, close, items }){
  useEffect(()=>{ function esc(e){ if(e.key==='Escape'){ close(); } } window.addEventListener('keydown',esc); return ()=> window.removeEventListener('keydown',esc); },[close]);
  return <div className="command-palette" role="dialog" aria-modal="true">
    <div className="command-panel">
      <input autoFocus className="command-input" placeholder="Type a command..." value={query} onChange={e=> setQuery(e.target.value)} />
      <div className="command-list">{items.map((c,i)=> <div key={i} className="command-item" onClick={()=> { c.action(); close(); }}><span className="cmd-label">{c.label}</span><span className="cmd-group">{c.group}</span></div>)}{!items.length && <div className="command-empty">No matches</div>}</div>
      <div className="command-hint">Ctrl+K • Esc to close</div>
    </div>
  </div>;
}
