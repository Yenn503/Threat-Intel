import React from 'react';

export function BarSeries({ data }){
  const max = Math.max(...data.map(d=>d.count||d.value||0),1);
  return <div className="bar-series">{data.map((d,i)=> {
    const key = (d.hour!=null? 'h-'+d.hour : d.label? 'l-'+d.label : 'i-'+i);
    return <div key={key} className="bar-wrap"><div className="bar" style={{height:((d.count||d.value||0)/max*100)+'%'}} title={(d.count||d.value||0)+" events @"+(d.hour||d.label)+":00"}></div><div className="bar-label">{d.hour||d.label}</div></div>;
  })}</div>;
}

export function MiniDonut({ counts }){
  const entries = Object.entries(counts||{});
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
