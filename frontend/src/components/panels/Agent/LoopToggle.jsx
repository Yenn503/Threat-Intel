import React from 'react';

export default function LoopToggle({ token, loop, onChange }){
  async function act(action){
    try {
      const r = await fetch(`http://localhost:4000/api/agent/loop/${action}`, { method:'POST', headers:{ Authorization:'Bearer '+token }});
      const data = await r.json();
      if(r.ok){ onChange && onChange(data.loop); }
    } catch {}
  }
  const paused = loop?.paused;
  return (
    <div className="loop-toggle">
      <button onClick={()=> act(paused? 'resume':'pause')} className={"btn small "+(paused?'accent':'')}>{paused? 'Resume Loop':'Pause Loop'}</button>
      <span className="loop-indicator" style={{marginLeft:8,fontSize:12,opacity:.7}}>{paused? 'Paused':'Active'}</span>
    </div>
  );
}
