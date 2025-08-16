import React, { useEffect, useState, useRef, useMemo } from 'react';
// DEPRECATION NOTICE: Reports will be folded into UnifiedAIAgent (reporting tab) soon.
// Fetches migrated to api/report module for consistency.
import { getReportSummary, getReportTimeseries, getReportFindings } from '../../api/report';
import useDebounce from '../../hooks/useDebounce.js';

function LineChart({ series, color='#4ea1ff' }){
  const ref = useRef(null);
  useEffect(()=>{
    if(!ref.current || !series.length) return; const c=ref.current; const ctx=c.getContext('2d');
    const w=c.width, h=c.height; ctx.clearRect(0,0,w,h);
    const max = Math.max(1,...series.map(p=>p.total));
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.beginPath();
    series.forEach((p,i)=>{ const x = (i/(series.length-1))* (w-10) +5; const y = h-5 - (p.total/max)*(h-20); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
    ctx.stroke();
    ctx.fillStyle=color; series.forEach((p,i)=>{ const x=(i/(series.length-1))*(w-10)+5; const y=h-5-(p.total/max)*(h-20); ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill(); });
  },[series,color]);
  return <canvas ref={ref} width={360} height={120} style={{width:'100%',height:120}} />;
}

function StackedChart({ series }){
  const ref = useRef(null);
  // Derive keys
  const keys = useMemo(()=>{
    const set = new Set(); series.forEach(s=> Object.keys(s.byType||{}).forEach(k=> set.add(k))); return Array.from(set).sort();
  },[series]);
  useEffect(()=>{
    if(!ref.current || !series.length) return; const c=ref.current; const ctx=c.getContext('2d');
    const w=c.width, h=c.height; ctx.clearRect(0,0,w,h);
    // colors palette
    const palette = ['#4ea1ff','#7bda5d','#ffb347','#ff6b6b','#b084ff','#17c3b2','#ffa600'];
    // Compute max stack height
    const max = Math.max(1,...series.map(p=> Object.values(p.byType||{}).reduce((a,b)=>a+b,0)));
    series.forEach((point, idx)=>{
      const x = (idx/(series.length-1)) * (w-40) + 20; // leave left padding
      let yBase = h-20; // bottom padding
      let colorIndex=0;
      keys.forEach(k=>{
        const v = (point.byType||{})[k]||0; if(!v) return; const barHeight = (v/max) * (h-40);
        ctx.fillStyle = palette[colorIndex % palette.length];
        colorIndex++;
        ctx.fillRect(x-8, yBase - barHeight, 16, barHeight);
        yBase -= barHeight;
      });
      // tick label every ~5 points
      if(idx % Math.ceil(series.length/8) ===0){ ctx.fillStyle='#888'; ctx.font='10px sans-serif'; ctx.fillText(new Date(point.ts).getHours()+':00', x-14, h-5); }
    });
    // legend
    ctx.font='10px sans-serif';
    keys.forEach((k,i)=>{
      ctx.fillStyle = palette[i % palette.length]; ctx.fillRect(w-90, 6 + i*12, 10,10);
      ctx.fillStyle='#ccc'; ctx.fillText(k, w-75, 15 + i*12);
    });
  },[series,keys]);
  return <canvas ref={ref} width={360} height={140} style={{width:'100%', height:140}} />;
}

// Compact relative time helper
const relTime = (ts)=>{ const d=Date.now()-ts; const s=Math.floor(d/1000); if(s<60) return s+'s'; const m=Math.floor(s/60); if(m<60) return m+'m'; const h=Math.floor(m/60); if(h<48) return h+'h'; const day=Math.floor(h/24); return day+'d'; };
const STATUS_COLORS = { queued:'#646464', pending:'#caa100', waiting:'#caa100', running:'#1f6feb', completed:'#2e8b57', failed:'#d73a49' };
const SEVERITY_COLORS = { critical:'#7f2aff', high:'#d73a49', medium:'#caa100', low:'#2e8b57', info:'#6a7a89' };

// Tiny sparkline canvas (aesthetic trend visual derived only from existing data volume)
function Sparkline({ data=[], color='#4ea1ff' }){
  const ref = useRef(null);
  useEffect(()=>{
    if(!ref.current || !data.length) return; const c=ref.current, ctx=c.getContext('2d'); const w=c.width, h=c.height; ctx.clearRect(0,0,w,h);
    const max=Math.max(...data), min=Math.min(...data);
    ctx.beginPath(); ctx.strokeStyle=color; ctx.lineWidth=1.4;
    data.forEach((v,i)=>{ const x=(i/(data.length-1||1))*(w-6)+3; const norm=max===min? .5:(v-min)/(max-min); const y=h-3 - norm*(h-6); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
    ctx.stroke();
  },[data,color]);
  return <canvas ref={ref} width={90} height={32} style={{width:'100%', height:32, opacity:data.length?1:.25}} />;
}

// Horizontal stacked bar for scan type distribution
function ScanTypesBar({ counts=[] }){
  const total = counts.reduce((a,b)=> a + (b.count||0),0) || 1;
  const palette=['#4ea1ff','#17c3b2','#7bda5d','#ffb347','#ff6b6b','#b084ff'];
  return <div style={{display:'flex', height:20, borderRadius:7, overflow:'hidden', border:'1px solid #163041', background:'#0d2735'}}>
    {counts.map((c,i)=>{ const pct=(c.count/total)*100; const bg=palette[i%palette.length]; return <div key={c.type} title={`${c.type}: ${c.count}`} style={{width:pct+'%', background:bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#062030', fontWeight:600}}>{pct>8? c.type:''}</div>; })}
  </div>;
}

function EmptyState({ children='Nothing here yet.' }){
  return <div style={{fontSize:12, opacity:.5, padding:'6px 4px'}}>{children}</div>;
}

function StatCards({ summary }){
  if(!summary) return null;
  const tasks = summary.tasks || [];
  const activeTasks = tasks.filter(t=> ['queued','pending','waiting','running'].includes(t.status)).length;
  const failedTasks = tasks.filter(t=> t.status==='failed').length;
  const totalScans = (summary.scanCounts||[]).reduce((a,b)=> a + (b.count||0),0);
  // Build spark data from recent items only (no fake values)
  let scanSpark=[]; if(summary.recentScans && summary.recentScans.length){
    const withTs = summary.recentScans.map(s=> new Date(s.created_at||s.updated_at||s.ts||Date.now()).getTime());
    const min=Math.min(...withTs), max=Math.max(...withTs); const span=max-min||1; const buckets=10; const arr=new Array(buckets).fill(0);
    withTs.forEach(ts=>{ const idx=Math.min(buckets-1, Math.floor(((ts-min)/span)*buckets)); arr[idx]++; });
    scanSpark=arr;
  }
  const taskSpark = tasks.slice(0,30).map(t=> ['running','queued','pending','waiting'].includes(t.status)?1:0);
  const cards=[
    { label:'Active Tasks', value:activeTasks, accent:'#1f6feb', spark:taskSpark },
    { label:'Total Scans', value:totalScans, accent:'#4ea1ff', spark:scanSpark },
    ...(failedTasks>0 ? [{ label:'Failed Tasks', value:failedTasks, accent:'#d73a49' }] : [])
  ];
  return <div style={{display:'grid', gap:14, gridTemplateColumns:`repeat(auto-fit,minmax(${cards.length>2?150:170}px,1fr))`, marginBottom:16}}>
    {cards.map(c=> <div key={c.label} style={{background:'linear-gradient(145deg,#0d2735,#0b1d28)', border:'1px solid #163041', borderRadius:14, padding:'10px 12px', position:'relative', overflow:'hidden', display:'flex', flexDirection:'column', gap:4}}>
      <div style={{position:'absolute', inset:0, background:`radial-gradient(circle at 75% 20%, ${c.accent}22, transparent 65%)`}} />
      <div style={{fontSize:11, opacity:.65, letterSpacing:.5}}>{c.label}</div>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:6}}>
        <div style={{fontSize:24, fontWeight:600, color:c.accent}}>{c.value}</div>
        {c.spark && c.spark.length>1 && <div style={{width:90}}><Sparkline data={c.spark} color={c.accent} /></div>}
      </div>
    </div>)}
  </div>;
}

// Collapsible section wrapper
function Section({ title, children, defaultOpen=true, right, compact=false }){
  const [open,setOpen] = useState(defaultOpen);
  return (
    <div style={{border:'1px solid #1d3547', borderRadius:10, background:'#0f1b24', padding: compact? '8px 10px':'10px 12px', marginBottom:14}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', userSelect:'none'}} onClick={()=> setOpen(o=>!o)}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <span style={{transform: open? 'rotate(90deg)':'rotate(0deg)', transition:'transform .18s', fontSize:12, opacity:.7}}>▶</span>
          <h3 style={{margin:0, fontSize:14}}>{title}</h3>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:10}}>{right}</div>
      </div>
      {open && <div style={{marginTop:10}}>{children}</div>}
    </div>
  );
}

function RecentScansTable({ scans, search }){
  const [visible,setVisible] = useState(15);
  useEffect(()=>{ setVisible(15); },[scans]);
  const filtered = useMemo(()=>{
    if(!search) return scans; const q=search.toLowerCase();
    return scans.filter(s=> (s.id && s.id.toLowerCase().includes(q)) || (s.type && s.type.toLowerCase().includes(q)) || (s.target && s.target.toLowerCase().includes(q)) );
  },[scans,search]);
  const slice = filtered.slice(0, visible);
  return (
    <div style={{marginTop:4, flex:1, display:'flex', flexDirection:'column'}}>
      <div style={{overflowX:'auto'}}>
        <table className="mini-table" style={{minWidth:520}}><thead><tr><th style={{width:90}}>ID</th><th>Type</th><th>Target</th><th>Status</th></tr></thead><tbody>
          {slice.map(s=> {
            const statusColor = STATUS_COLORS[s.status] || '#546372';
            return <tr key={s.id} style={{cursor:'pointer'}} title={s.id} onClick={()=> console.log('scan', s.id)}>
              <td>{s.id.slice(0,8)}</td>
              <td>{s.type}</td>
              <td style={{maxWidth:260, overflow:'hidden', textOverflow:'ellipsis'}} title={s.target}>{s.target}</td>
              <td><span style={{fontSize:10, background: statusColor+'22', color:statusColor, padding:'2px 6px', borderRadius:12, fontWeight:600}}>{s.status}</span></td>
            </tr>;
          })}
        </tbody></table>
      </div>
      <div style={{display:'flex', alignItems:'center', gap:12, marginTop:6}}>
        <div style={{fontSize:10, opacity:.55}}>{slice.length} shown • {filtered.length} filtered • {scans.length} total</div>
        {slice.length < filtered.length && <button onClick={()=> setVisible(v=> v+15)} style={{fontSize:11, background:'#12384f', color:'#cfe8f7', border:'1px solid #1d4b66', padding:'4px 12px', borderRadius:14, cursor:'pointer'}}>Load more</button>}
      </div>
    </div>
  );
}

function TaskList({ tasks, generatedAt, search }){
  const [filter,setFilter] = React.useState('active'); // active|recent|failed|all
  const [visible,setVisible] = React.useState(20);
  // reset visible when tasks change or filter changes
  useEffect(()=>{ setVisible(20); },[filter, tasks]);
  const baseFiltered = React.useMemo(()=>{
    let list=[...tasks];
    if(filter==='active') list = list.filter(t=> ['queued','pending','waiting','running'].includes(t.status));
    else if(filter==='failed') list = list.filter(t=> t.status==='failed');
    else if(filter==='recent') list = list.slice(0,30);
    return list;
  },[tasks, filter]);
  const searched = useMemo(()=>{ if(!search) return baseFiltered; const q=search.toLowerCase(); return baseFiltered.filter(t=> (t.instruction && t.instruction.toLowerCase().includes(q)) || (t.id && t.id.toLowerCase().includes(q))); },[baseFiltered, search]);
  const slice = searched.slice(0, visible);
  const filters = ['active','recent','failed','all'];
  return (
  <div style={{display:'flex', flexDirection:'column'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
        <h3 style={{margin:0, fontSize:14}}>Tasks</h3>
        <div style={{display:'flex', gap:6}}>
          {filters.map(f=> {
            const active = f===filter; return <button key={f} onClick={()=> setFilter(f)} style={{
              fontSize:10, padding:'4px 10px', borderRadius:14, cursor:'pointer',
              border:'1px solid '+(active?'#2d5b89':'#1d3547'), background: active?'#12384f':'#0e2735', color:'#cfe8f7'
            }}>{f}</button>;
          })}
        </div>
      </div>
  <div style={{fontSize:10, opacity:.55, marginBottom:6}}>{slice.length} shown • {searched.length} filtered • {baseFiltered.length} base • {tasks.length} total</div>
  <div style={{display:'flex', flexDirection:'column', gap:10}}>
        {!slice.length && <div style={{fontSize:11, opacity:.5}}>No tasks.</div>}
        {slice.map(t=>{
          const color = STATUS_COLORS[t.status] || '#888';
          const isRunning = t.status==='running';
          const isQueued = ['queued','pending','waiting'].includes(t.status);
          const created = t.created_at? new Date(t.created_at).getTime(): null;
          const updated = t.updated_at? new Date(t.updated_at).getTime(): null;
          const elapsedMs = (created && updated)? (updated - created): null;
          const elapsed = elapsedMs? (elapsedMs/1000<60? Math.round(elapsedMs/1000)+'s': Math.round(elapsedMs/60000)+'m'): '';
          return (
            <div key={t.id} style={{display:'flex', flexDirection:'column', gap:6, background:'#111d28', border:'1px solid #162633', borderRadius:12, padding:'8px 10px', position:'relative'}}>
              <div style={{display:'flex', alignItems:'center', gap:12}}>
                <div style={{width:16, height:16, position:'relative'}}>
                  {isRunning && <div style={{width:16, height:16, borderRadius:'50%', border:'2px solid '+color, borderTopColor:'transparent', animation:'spin 0.8s linear infinite'}}></div>}
                  {isQueued && !isRunning && <div style={{width:16, height:16, borderRadius:'50%', background:color+'33', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:color}}>⏱</div>}
                  {t.status==='completed' && <div style={{width:16, height:16, borderRadius:'50%', background:color+'33', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:color}}>✔</div>}
                  {t.status==='failed' && <div style={{width:16, height:16, borderRadius:'50%', background:color+'33', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:color}}>✖</div>}
                </div>
                <div style={{display:'flex', flexDirection:'column', flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                    {t.instruction && <div style={{fontSize:11, fontWeight:500, maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={t.instruction}>{t.instruction}</div>}
                    <span style={{fontSize:10, background: color+'22', color, padding:'2px 6px', borderRadius:12, fontWeight:600, textTransform:'uppercase'}}>{t.status}</span>
                    {elapsed && <span style={{fontSize:10, opacity:.55}}>{elapsed}</span>}
                    <code style={{fontSize:10, opacity:.5}} title={t.id}>{t.id.slice(0,8)}</code>
                  </div>
                  {isRunning && <div style={{height:4, borderRadius:2, background:'#0d2533', marginTop:6, overflow:'hidden'}}>
                    <div style={{width:'60%', height:'100%', background:color, animation:'pulse-width 2s ease-in-out infinite', opacity:.85}}></div>
                  </div>}
                </div>
                <div style={{position:'relative'}}>
                  <button style={{background:'transparent', border:'1px solid #1d3547', color:'#cfe8f7', borderRadius:6, fontSize:12, padding:'2px 6px', cursor:'pointer'}} onClick={(e)=>{
                    const menu = e.currentTarget.nextSibling; if(menu) menu.style.display = menu.style.display==='flex'? 'none':'flex'; e.stopPropagation();
                  }}>⋮</button>
                  <div style={{display:'none', position:'absolute', right:0, top:'110%', background:'#0f1b24', border:'1px solid #1d3547', borderRadius:8, padding:6, flexDirection:'column', gap:4, minWidth:140, zIndex:4}}>
                    <button className="btn tiny" style={{textAlign:'left'}} disabled>View Details</button>
                    <button className="btn tiny" style={{textAlign:'left'}} disabled>Stop Task</button>
                    <button className="btn tiny" style={{textAlign:'left'}} disabled>Re-run Task</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {slice.length < baseFiltered.length && <button onClick={()=> setVisible(v=> v+20)} style={{
        marginTop:12, alignSelf:'flex-start', fontSize:11, background:'#12384f', color:'#cfe8f7', border:'1px solid #1d4b66', padding:'6px 14px', borderRadius:16, cursor:'pointer'
      }}>Load more</button>}
    </div>
  );
}

export default function Reports({ token }){
  const [summary,setSummary] = useState(null);
  const [loading,setLoading] = useState(true); // summary load
  const [error,setError] = useState('');
  const [tab,setTab] = useState('summary'); // tabs: summary | tasks | scans | findings
  const [compact,setCompact] = useState(false); // hide charts & recent scans for minimal view
  const [showVolume,setShowVolume] = useState(true);
  const [showRecentScans,setShowRecentScans] = useState(true);
  const [ts,setTs] = useState(null);
  const [findings,setFindings] = useState(null);
  const [stacked,setStacked] = useState(false);
  const [tsFilters,setTsFilters] = useState({ hours:48, types:'', target:'' });
  const [findingFilters,setFindingFilters] = useState({ severity:'', target:'' });
  const debouncedTs = useDebounce(tsFilters, 400);
  const debouncedFind = useDebounce(findingFilters, 400);
  const [loadingTs,setLoadingTs] = useState(false);
  const [loadingFindings,setLoadingFindings] = useState(false);
  // Summary (once per token)
  useEffect(()=>{ if(!token) return; setLoading(true); getReportSummary(token)
      .then(res=>{ if(!res.ok) throw new Error(res.error||'error'); setSummary(res.data); })
      .catch(e=> setError(e.message))
      .finally(()=> setLoading(false)); },[token]);
  // Timeseries (debounced) – only fetch when scans tab active
  useEffect(()=>{ if(!token || tab!=='scans') return; setLoadingTs(true); getReportTimeseries(token, { hours: debouncedTs.hours, types: debouncedTs.types, targetContains: debouncedTs.target })
      .then(res=>{ if(res.ok && res.data) setTs(res.data); })
      .finally(()=> setLoadingTs(false)); },[token, debouncedTs, tab]);
  // Findings (debounced) – only fetch when findings tab active
  useEffect(()=>{ if(!token || tab!=='findings') return; setLoadingFindings(true); getReportFindings(token, { severity: debouncedFind.severity, targetContains: debouncedFind.target })
      .then(res=>{ if(res.ok && res.data) setFindings(res.data); })
      .finally(()=> setLoadingFindings(false)); },[token, debouncedFind, tab]);

  const dl = (path)=>{ const a=document.createElement('a'); a.href=`http://localhost:4000/api/ai${path}?t=${Date.now()}`; a.setAttribute('download',''); a.setAttribute('target','_blank'); a.click(); };
  const [dlOpen,setDlOpen] = useState(false);
  const [globalSearch,setGlobalSearch] = useState('');
  useEffect(()=>{
    if(!dlOpen) return; const on = (e)=>{ if(!e.target.closest('.dl-menu')) setDlOpen(false); }; document.addEventListener('mousedown', on); return ()=> document.removeEventListener('mousedown', on);
  },[dlOpen]);

  return <div className="panel-shell fade-in reports-panel">
    <h2 style={{marginTop:0}}>Reporting & Exports</h2>
    {/* Unified header: tabs (left), primary & secondary actions (right) */}
    <div style={{display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', padding:'4px 0 4px'}}>
      <div style={{display:'flex', alignItems:'center', gap:6}}>
        {['summary','tasks','scans','findings'].map(t=> {
          const active = tab===t;
          return <button key={t} onClick={()=>setTab(t)} style={{
            textTransform:'capitalize',
            padding:'6px 14px',
            fontSize:12,
            borderRadius:18,
            border:'1px solid '+(active?'#2d5b89':'#1d3547'),
            background: active? 'linear-gradient(135deg,#124364,#0d2635)': 'rgba(13,38,53,0.55)',
            boxShadow: active? '0 0 0 1px #1e5d85 inset, 0 2px 4px #0008': '0 0 0 1px #0b1e29 inset',
            color:'#cfe8f7', cursor:'pointer', letterSpacing:'.5px'
          }}>{t}</button>;
        })}
      </div>
      <div style={{flex:1}} />
      <div style={{display:'flex', alignItems:'center', gap:10}}>
        {/* Search primary action */}
        <div style={{position:'relative'}}>
          <span style={{position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', fontSize:13, opacity:.55}}>🔍</span>
          <input value={globalSearch} onChange={e=> setGlobalSearch(e.target.value)} placeholder="Search..." aria-label="Search" style={{background:'#0d2735', border:'1px solid #1d3547', borderRadius:18, padding:'6px 30px 6px 26px', fontSize:12, width:190, color:'#cfe8f7'}} />
        </div>
        {/* Download secondary action */}
        <div style={{position:'relative'}} className="dl-menu">
          <button className="btn small" style={{background:'transparent', border:'1px solid #1d3547', color:'#cfe8f7'}} onClick={()=> setDlOpen(o=> !o)}>Download ▾</button>
          {dlOpen && <div style={{position:'absolute', right:0, top:'110%', background:'#0f1b24', border:'1px solid #1d3547', borderRadius:8, padding:6, display:'flex', flexDirection:'column', minWidth:170, zIndex:5, boxShadow:'0 4px 14px -2px #000a'}}>
            <button className="btn tiny" style={{textAlign:'left'}} onClick={()=> dl('/export/tasks.csv')}>Tasks CSV</button>
            <button className="btn tiny" style={{textAlign:'left'}} onClick={()=> dl('/export/scans.csv')}>Scans CSV</button>
            <button className="btn tiny" style={{textAlign:'left'}} onClick={()=> dl('/export/findings.csv')}>Findings CSV</button>
          </div>}
        </div>
      </div>
    </div>
    {/* Tertiary view modifiers live just under header, scoped to tab */}
    {tab==='summary' && <div style={{marginTop:2, marginBottom:4}}>
      <label style={{fontSize:11, display:'inline-flex', alignItems:'center', gap:6, background:'rgba(255,255,255,0.04)', padding:'4px 10px', borderRadius:14}}>
        <input type="checkbox" checked={compact} onChange={e=> setCompact(e.target.checked)} /> Compact Summary
      </label>
    </div>}
    {loading && <div className="skeleton-line" style={{width:'40%'}}></div>}
    {error && <div className="form-error" style={{marginTop:8}}>{error}</div>}
  {!loading && summary && tab==='summary' && (
    !compact ? <div style={{marginTop:16}}>
      <StatCards summary={summary} />
      <Section title="Scan Types" defaultOpen={false} compact>
        {summary.scanCounts.length? <div style={{display:'flex', flexDirection:'column', gap:10}}>
          <ScanTypesBar counts={summary.scanCounts} />
          <table className="mini-table"><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>{summary.scanCounts.map(r=> <tr key={r.type}><td>{r.type}</td><td>{r.count}</td></tr>)}</tbody></table>
        </div>: <div className="empty-note">No scans.</div>}
      </Section>
      <Section title="Recent Activity" defaultOpen={false}>
        <ActivityFeed summary={summary} />
      </Section>
    </div> :
    <div style={{marginTop:16}}>
      <StatCards summary={summary} />
    </div>
  )}
    {/* Scans Tab */}
    {!loading && summary && tab==='scans' && (
      <div style={{marginTop:12, maxWidth:1100}}>
        <Section title="Counts" defaultOpen={true}>
          {summary.scanCounts.length? <table className="mini-table"><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>{summary.scanCounts.map(r=> <tr key={r.type}><td>{r.type}</td><td>{r.count}</td></tr>)}</tbody></table>: <div className="empty-note">No scans.</div>}
        </Section>
        <Section title="Volume & Trends" defaultOpen={false} right={<button className="btn tiny" onClick={(e)=>{ e.stopPropagation(); setTsFilters({ hours:48, types:'', target:'' }); }}>Reset</button>}>
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            <div className="filters-row" style={{display:'flex', gap:10, flexWrap:'wrap'}}>
              <label style={{fontSize:11}}>Hours
                <input type="number" min={1} max={336} value={tsFilters.hours} onChange={e=> setTsFilters(f=>({...f, hours: e.target.value}))} style={{width:70}} />
              </label>
              <label style={{fontSize:11}}>Types
                <input type="text" placeholder="nmap,nuclei" value={tsFilters.types} onChange={e=> setTsFilters(f=>({...f, types:e.target.value}))} style={{width:140}} />
              </label>
              <label style={{fontSize:11}}>Target
                <input type="text" placeholder="substr" value={tsFilters.target} onChange={e=> setTsFilters(f=>({...f, target:e.target.value}))} style={{width:160}} />
              </label>
            </div>
            {(debouncedTs.types || debouncedTs.target) && <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
              {debouncedTs.types && <span style={{fontSize:10, background:'rgba(255,255,255,0.08)', padding:'2px 6px', borderRadius:12}}>types: {debouncedTs.types}</span>}
              {debouncedTs.target && <span style={{fontSize:10, background:'rgba(255,255,255,0.08)', padding:'2px 6px', borderRadius:12}}>target: {debouncedTs.target}</span>}
            </div>}
            {loadingTs && <div className="skeleton-line" style={{width:'50%'}}></div>}
            {ts && ts.series.length>0 && (
              <div style={{position:'relative'}}>
                <div style={{position:'absolute', top:0, right:0, zIndex:2}}>
                  <label style={{fontSize:11, display:'flex', alignItems:'center', gap:4, cursor:'pointer'}}>
                    <input type="checkbox" checked={stacked} onChange={e=> setStacked(e.target.checked)} /> Stacked
                  </label>
                </div>
                {!stacked && <LineChart series={ts.series} />}
                {stacked && <StackedChart series={ts.series} />}
              </div>
            )}
          </div>
        </Section>
        <Section title="Recent Scans" defaultOpen={true}>
          <RecentScansTable scans={summary.recentScans} search={globalSearch} />
        </Section>
      </div>
    )}
    {/* Tasks Tab */}
    {!loading && summary && tab==='tasks' && (
      <div style={{marginTop:16}}>
        <div className="card-glass" style={{padding:'12px', background:'#0f1b24', backdropFilter:'none'}}>
          <TaskList tasks={summary.tasks} generatedAt={summary.generatedAt} search={globalSearch} />
        </div>
      </div>
    )}
  {tab==='findings' && <div style={{marginTop:12, maxWidth:1100}}>
      <Section title="Filters" defaultOpen={false} compact>
        <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
          <label style={{fontSize:11}}>Severity
            <input type="text" placeholder="critical,high" value={findingFilters.severity} onChange={e=> setFindingFilters(f=>({...f, severity:e.target.value}))} style={{width:140}} />
          </label>
          <label style={{fontSize:11}}>Target
            <input type="text" placeholder="substr" value={findingFilters.target} onChange={e=> setFindingFilters(f=>({...f, target:e.target.value}))} style={{width:160}} />
          </label>
          <button className="btn tiny" onClick={()=> setFindingFilters({ severity:'', target:'' })}>Reset</button>
        </div>
        {(debouncedFind.severity || debouncedFind.target) && <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:10}}>
          {debouncedFind.severity && <span style={{fontSize:10, background:'rgba(255,255,255,0.08)', padding:'2px 6px', borderRadius:12}}>severity: {debouncedFind.severity}</span>}
          {debouncedFind.target && <span style={{fontSize:10, background:'rgba(255,255,255,0.08)', padding:'2px 6px', borderRadius:12}}>target: {debouncedFind.target}</span>}
        </div>}
      </Section>
      <Section title="Severity Distribution" defaultOpen={true}>
        {!findings && <div className="skeleton-line" style={{width:'40%'}}></div>}
        {findings && Object.keys(findings.severityCounts).length===0 && <div className="empty-note">No findings.</div>}
        {findings && Object.keys(findings.severityCounts).length>0 && <table className="mini-table"><thead><tr><th>Severity</th><th>Count</th></tr></thead><tbody>
          {Object.entries(findings.severityCounts).sort((a,b)=> b[1]-a[1]).map(([sev,c])=> <tr key={sev}><td>{sev}</td><td>{c}</td></tr>)}
        </tbody></table>}
      </Section>
      <Section title="Recent Findings" defaultOpen={true}>
        {loadingFindings && <div className="skeleton-line" style={{width:'55%'}}></div>}
        {!loadingFindings && findings && findings.findings.length===0 && <div className="empty-note">No findings.</div>}
  {!loadingFindings && findings && findings.findings.length>0 && <FindingsList data={findings.findings} search={globalSearch} />}
      </Section>
    </div>}
  </div>;
}

// Findings list with load more minimal columns
function FindingsList({ data, search }){
  const [visible,setVisible] = useState(40);
  useEffect(()=>{ setVisible(40); },[data]);
  const filtered = useMemo(()=>{ if(!search) return data; const q=search.toLowerCase(); return data.filter(f=> (f.title && f.title.toLowerCase().includes(q)) || (f.target && f.target.toLowerCase().includes(q)) || (f.severity && f.severity.toLowerCase().includes(q))); },[data,search]);
  const slice = filtered.slice(0, visible);
  return (
    <div>
      <table className="mini-table"><thead><tr><th style={{width:140}}>Target</th><th>Title</th><th style={{width:100}}>Severity</th></tr></thead><tbody>
        {slice.map(f=> {
          const sevColor = SEVERITY_COLORS[f.severity?.toLowerCase()] || '#546372';
          return <tr key={f.id+f.ts} style={{cursor:'pointer'}} onClick={()=> console.log('finding', f.id)}>
            <td style={{maxWidth:140, overflow:'hidden', textOverflow:'ellipsis'}} title={f.target}>{f.target}</td>
            <td style={{maxWidth:360, overflow:'hidden', textOverflow:'ellipsis'}} title={f.title}>{f.title}</td>
            <td><span style={{fontSize:10, background: sevColor+'22', color:sevColor, padding:'2px 8px', borderRadius:12, fontWeight:600, textTransform:'uppercase'}}>{f.severity}</span></td>
          </tr>; })}
      </tbody></table>
      <div style={{display:'flex', alignItems:'center', gap:12, marginTop:8}}>
        <div style={{fontSize:10, opacity:.55}}>{slice.length} shown • {filtered.length} filtered • {data.length} total</div>
        {slice.length < filtered.length && <button className="btn tiny" onClick={()=> setVisible(v=> v+40)}>Load more</button>}
      </div>
    </div>
  );
}

function ActivityFeed({ summary }){
  if(!summary) return null;
  const events=[];
  (summary.tasks||[]).slice(0,80).forEach(t=>{
    const ts=new Date(t.updated_at||t.created_at||Date.now()).getTime();
    events.push({ ts, type:'task', status:t.status, label:t.instruction||'Task', id:t.id });
  });
  (summary.recentScans||[]).slice(0,80).forEach(s=>{
    const ts=new Date(s.updated_at||s.created_at||s.ts||Date.now()).getTime();
    events.push({ ts, type:'scan', status:s.status, label:s.type+' → '+(s.target||''), id:s.id });
  });
  events.sort((a,b)=> b.ts-a.ts);
  const limited=events.slice(0,40);
  if(!limited.length) return <EmptyState>No recent activity.</EmptyState>;
  return <div style={{display:'flex', flexDirection:'column', gap:6}}>
    {limited.map(e=>{ const color = STATUS_COLORS[e.status] || '#4ea1ff'; return <div key={e.type+e.id+e.ts} style={{display:'flex', alignItems:'center', gap:8, fontSize:12, background:'#111d28', padding:'6px 8px', border:'1px solid #162633', borderRadius:8}}>
      <span style={{width:8, height:8, borderRadius:'50%', background:color}} />
      <div style={{flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={e.label}>{e.label}</div>
      <span style={{fontSize:10, background:color+'22', color:color, padding:'2px 6px', borderRadius:10, fontWeight:600}}>{e.type}</span>
      <span style={{fontSize:10, opacity:.55}}>{relTime(e.ts)}</span>
    </div>; })}
  </div>;
}
