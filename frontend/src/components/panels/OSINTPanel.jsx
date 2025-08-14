import React, { useState, useEffect, useMemo, useRef } from 'react';
import arfData from '../../osint-arf.json';

export default function OSINTPanel(){
  const [mode,setMode] = useState('tree');
  const [collapsed,setCollapsed] = useState(()=> new Set());
  const [scale,setScale] = useState(1);
  const [fit,setFit] = useState(true);
  const containerRef = useRef(null);
  const [viewport,setViewport] = useState({ w:0, h:0 });
  const [data] = useState(()=> arfData);
  const root = useMemo(()=>{ if(!data) return null; let i=0; function walk(n,depth=0,parentId='r'){ const id=parentId+'-'+(i++).toString(36); return { ...n, __id:id, depth, children:(n.children||[]).map(c=> walk(c,depth+1,id)) }; } return walk(data); },[data]);
  const layout = useMemo(()=>{ if(!root) return null; const nodes=[]; const links=[]; let y=0; const rowH=20; const xGap=260; const leftPad=20; const topPad=10; function walk(n){ nodes.push({ n, x:n.depth*xGap, y:y*rowH }); const isCol=collapsed.has(n.__id); y++; if(!isCol){ (n.children||[]).forEach(c=>{ links.push({ from:n, to:c }); walk(c); }); } } walk(root); const labelWidth = nodes.reduce((m,o)=> Math.max(m, (o.n.name||'').length*7 + 24), 0); const nodeMap=Object.fromEntries(nodes.map(o=>[o.n.__id,o])); const linkPaths=links.map(l=>{ const a=nodeMap[l.from.__id]; const b=nodeMap[l.to.__id]; const mx=(a.x+b.x)/2; return `M${a.x+leftPad},${a.y+topPad}C${mx+leftPad},${a.y+topPad} ${mx+leftPad},${b.y+topPad} ${b.x+leftPad},${b.y+topPad}`; }); const maxX = Math.max(...nodes.map(o=>o.x)); const width = maxX + leftPad + labelWidth; const height = (y+1)*rowH + topPad + 40; return { nodes, links, linkPaths, width, height, leftPad, topPad }; },[root, collapsed]);
  function toggle(n){ if(!n.children||!n.children.length) return; setCollapsed(s=>{ const ns=new Set(s); ns.has(n.__id)? ns.delete(n.__id): ns.add(n.__id); return ns; }); }
  useEffect(()=>{ if(!containerRef.current) return; const el=containerRef.current; const ro=new ResizeObserver(()=> setViewport({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setViewport({ w: el.clientWidth, h: el.clientHeight }); return ()=> ro.disconnect(); },[]);
  useEffect(()=>{ if(!layout || !containerRef.current || !fit) return; const available = viewport.w - 32; if(available>0){ const next = Math.min(1, available / layout.width); setScale(next<0.1?0.1:next); } },[layout, fit, viewport]);
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
  useEffect(()=>{ function attach(n, path='root'){ n.__id = path; if(n.children) n.children.forEach(c=> attach(c, path+'/'+(c.name||Math.random().toString(36).slice(2)))); } attach(arf); },[arf]);
  const sizes = useMemo(()=>{ function calc(n){ if(collapsed.has(n.__id) || !n.children || !n.children.length) return 1; return n.children.reduce((a,c)=> a+calc(c), 1); } return calc(arf); },[arf, collapsed]);
  const layout = useMemo(()=>{ const nodes=[]; const links=[]; const RING=70; const TWO_PI=Math.PI*2; function subtreeCount(n){ if(collapsed.has(n.__id) || !n.children || !n.children.length) return 1; return n.children.reduce((a,c)=> a+subtreeCount(c),1); } const total = subtreeCount(arf); function place(n, depth, a0, a1, parent){ const angle=(a0+a1)/2; const radius = depth*RING; const x=Math.cos(angle)*radius; const y=Math.sin(angle)*radius; const entry={ node:n, x,y, angle, depth }; nodes.push(entry); if(parent) links.push({ from:parent, to:entry }); if(!collapsed.has(n.__id) && n.children && n.children.length){ let acc=a0; const subtotal=subtreeCount(n); n.children.forEach(c=>{ const slice = (subtreeCount(c)/subtotal)*(a1-a0); place(c, depth+1, acc, acc+slice, entry); acc+=slice; }); } } place(arf,0,-Math.PI/2,-Math.PI/2+TWO_PI,null); return { nodes, links }; },[arf, collapsed, sizes]);
  useEffect(()=>{ if(!containerRef.current) return; const el=containerRef.current; const canvas=el.querySelector('canvas'); if(!canvas) return; const ctx=canvas.getContext('2d'); function draw(){ const w=el.clientWidth, h=el.clientHeight; canvas.width=w; canvas.height=h; ctx.clearRect(0,0,w,h); ctx.save(); ctx.translate(w/2,h/2); ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1; layout.links.forEach(l=>{ ctx.beginPath(); ctx.moveTo(l.from.x,l.from.y); ctx.lineTo(l.to.x,l.to.y); ctx.stroke(); }); layout.nodes.forEach(o=>{ const n=o.node; const type=n.type||'default'; const color = TYPE_COLORS[type]||TYPE_COLORS.default; const hot = hover && hover.node===n; const r = n.children && n.children.length ? 11 : 7; ctx.beginPath(); ctx.fillStyle=color; ctx.globalAlpha = hot? .95 : (n.children && n.children.length ? .3:.55); ctx.arc(o.x,o.y, hot? r+2:r,0,Math.PI*2); ctx.fill(); if(hot){ ctx.globalAlpha=1; ctx.font='500 11px Inter'; ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillStyle='#e2e8f0'; ctx.fillText(n.name.slice(0,50), o.x, o.y-14); } }); ctx.restore(); } draw(); const ro=new ResizeObserver(draw); ro.observe(el); return ()=> ro.disconnect(); },[layout, hover]);
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
