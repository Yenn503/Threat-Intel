import React, { useState, useEffect, useRef, useMemo } from 'react';
import useDebounce from '../../hooks/useDebounce.js';
import { useServerHealth } from '../providers/ServerHealthProvider.jsx';
// Centralized API modules
import {
  getAgentTools,
  getAgentHealth,
  listAgentTasks,
  agentChat,
  agentExecute,
  getRecentAgentEvents,
  getMetricsSnapshots
} from '../../api/agent.js';
import { getReportSummary, getReportTimeseries, getReportFindings } from '../../api/report.js';
import { getBinaries } from '../../api/scans.js';
import useReconnectingWebSocket from '../../hooks/useReconnectingWebSocket.js';

/*
 Unified AI Agent Panel
 Combines: Chat (from AIAgentPanel), Live Events (AgentEvents), Report (light summary)
 Left pane: Task history list (select to focus). Right pane: tabs per selected task.
*/
export default function UnifiedAIAgent({ token, active }){
  const { serverDown, markSuccess, markFailure } = useServerHealth();
  // Core task/chat state
  const [tasks,setTasks] = useState([]);
  const [selectedTaskId,setSelectedTaskId] = useState(null);
  const [messages,setMessages] = useState([]);
  const [input,setInput] = useState('Recon scanme.nmap.org and summarize');
  const [sending,setSending] = useState(false);
  const [autoPlan,setAutoPlan] = useState(false);
  const [lastSuggestedPlan,setLastSuggestedPlan] = useState([]);
  const [tools,setTools] = useState([]);
  const [llmReady,setLlmReady] = useState(true);
  const [binaries,setBinaries] = useState(null);
  const bottomRef = useRef(null);
  const [tab,setTab] = useState('chat'); // chat | events | summary | scans | findings

  // Events + metrics
  const [events,setEvents] = useState([]); // websocket + initial recent fetch
  const [connected,setConnected] = useState(false);
  const [follow,setFollow] = useState(true);
  const [eventSearch,setEventSearch] = useState('');
  const [filterType,setFilterType] = useState('');
  const [metrics,setMetrics] = useState(null);
  const [snapshots,setSnapshots] = useState([]);
  // Reconnecting WS abstraction
  const eventsScrollRef = useRef(null);

  // Reporting states (ported from legacy Reports panel)
  const [summary,setSummary] = useState(null); // /report/summary
  const [summaryLoading,setSummaryLoading] = useState(false);
  const [summaryError,setSummaryError] = useState('');
  const [compact,setCompact] = useState(false);
  const [globalSearch,setGlobalSearch] = useState('');
  const [dlOpen,setDlOpen] = useState(false);
  const [ts,setTs] = useState(null); // timeseries
  const [loadingTs,setLoadingTs] = useState(false);
  const [stacked,setStacked] = useState(false);
  const [findings,setFindings] = useState(null);
  const [loadingFindings,setLoadingFindings] = useState(false);
  const [tsFilters,setTsFilters] = useState({ hours:48, types:'', target:'' });
  const [findingFilters,setFindingFilters] = useState({ severity:'', target:'' });
  const debouncedTs = useDebounce(tsFilters, 400);
  const debouncedFind = useDebounce(findingFilters, 400);

  // Constants reused
  const STATUS_COLORS = { queued:'#646464', pending:'#caa100', waiting:'#caa100', running:'#1f6feb', completed:'#2e8b57', failed:'#d73a49' };
  const SEVERITY_COLORS = { critical:'#7f2aff', high:'#d73a49', medium:'#caa100', low:'#2e8b57', info:'#6a7a89' };

  // Tools & health
  useEffect(()=>{ if(!token||!active||serverDown) return; (async()=>{ const r = await getAgentTools(token); if(r.ok){ setTools(r.data.tools||[]); markSuccess(); } else { markFailure(); } })(); },[token, active, serverDown]);
  useEffect(()=>{ if(!token||!active||serverDown) return; (async()=>{ const r = await getAgentHealth(token); if(r.ok){ setLlmReady(!!r.data.llm); markSuccess(); } else { markFailure(); } })(); },[token, active, serverDown]);
  useEffect(()=>{ if(!token||!active) return; let id; const load=async()=>{ if(serverDown){ id=setTimeout(load,10000); return; } const r=await getBinaries(token); if(r.ok){ setBinaries(r.data.binaries); markSuccess(); } else { markFailure(); } id=setTimeout(load,30000); }; load(); return ()=> clearTimeout(id); },[token, active, serverDown]);

  // Tasks polling (also refresh summary tasks when summary loaded)
  useEffect(()=>{ if(!token||!active) return; let timer; let fail=0; const poll= async()=>{
      if(serverDown){ timer=setTimeout(poll, 10000); return; }
      const r = await listAgentTasks(token);
      // Treat an empty tasks array as a successful response (previous logic falsely flagged empty arrays as failure)
      const raw = r.ok ? (r.data?.data || r.data) : null;
      const hasTasksProp = raw && Array.isArray(raw.tasks);
      if(r.ok && hasTasksProp){
        const arr = raw.tasks;
        const map=new Map(); arr.forEach(t=> map.set(t.id,t));
        const list=Array.from(map.values()).sort((a,b)=> b.created_at - a.created_at).slice(0,100);
        setTasks(list);
        if(!selectedTaskId && list.length) setSelectedTaskId(list[0].id);
        const running=list.some(t=> ['pending','running','waiting','queued'].includes(t.status));
        fail=0; markSuccess();
        timer=setTimeout(poll, running? 3000: 8000);
      } else {
        // Only count as failure if the request itself failed (not merely empty tasks property missing)
        fail++; markFailure();
        const delay=Math.min(30000, 2000 * Math.pow(2, fail-1));
        timer=setTimeout(poll, delay);
      }
    };
    poll(); return ()=> clearTimeout(timer); },[token, active, selectedTaskId, serverDown]);

  // Summary fetch (on token or when summary-like tabs in view) with health gating
  useEffect(()=>{ if(!token||!active||serverDown) return; if(!['summary','scans','findings'].includes(tab)) return; let cancelled=false; (async()=>{ setSummaryLoading(true); setSummaryError(''); const r=await getReportSummary(token); if(cancelled) return; if(r.ok){ setSummary(r.data); markSuccess(); } else { setSummaryError(r.error||'error'); markFailure(); } setSummaryLoading(false); })(); return ()=> { cancelled=true; }; },[token, active, tab, serverDown]);

  // Time series fetch
  useEffect(()=>{ if(!token||!active||serverDown) return; if(tab!=='scans') return; setLoadingTs(true); (async()=>{ const r=await getReportTimeseries(token,{ hours:debouncedTs.hours, types:debouncedTs.types, targetContains:debouncedTs.target }); if(r.ok){ setTs(r.data); markSuccess(); } else { markFailure(); } setLoadingTs(false); })(); },[token, active, debouncedTs, tab, serverDown]);

  // Findings fetch
  useEffect(()=>{ if(!token||!active||serverDown) return; if(tab!=='findings') return; setLoadingFindings(true); (async()=>{ const r=await getReportFindings(token,{ severity:debouncedFind.severity, targetContains:debouncedFind.target }); if(r.ok){ setFindings(r.data); markSuccess(); } else { markFailure(); } setLoadingFindings(false); })(); },[token, active, debouncedFind, tab, serverDown]);

  // Close download menu on outside click
  useEffect(()=>{ if(!dlOpen) return; const on=(e)=>{ if(!e.target.closest('.dl-menu')) setDlOpen(false); }; document.addEventListener('mousedown', on); return ()=> document.removeEventListener('mousedown', on); },[dlOpen]);

  // Initial recent events & snapshots
  useEffect(()=>{ if(!token||!active||serverDown) return; (async()=>{ const r=await getRecentAgentEvents(token); if(r.ok){ const d=r.data; if(d.events) { setEvents(d.events.map(ev=> ({ ts: ev.ts||Date.now(), event: ev }))); markSuccess(); } else markFailure(); } else { markFailure(); } })(); },[token, active, serverDown]);
  useEffect(()=>{ if(!token||!active||serverDown) return; (async()=>{ const r=await getMetricsSnapshots(token); if(r.ok){ const d=r.data; if(d.snapshots) { setSnapshots(d.snapshots.slice(-50)); markSuccess(); } else markFailure(); } else { markFailure(); } })(); },[token, active, serverDown]);

  // Metrics snapshots polling
  useEffect(()=>{ if(!token||!active) return; let id; let fail=0; const loop=async()=>{ if(serverDown){ id=setTimeout(loop, 15000); return; } const r=await getMetricsSnapshots(token); if(r.ok && r.data.snapshots){ setSnapshots(r.data.snapshots.slice(-50)); fail=0; markSuccess(); } else { fail++; markFailure(); } id=setTimeout(loop, Math.min(60000, 30000 * (fail? Math.pow(1.5, fail):1))); }; loop(); return ()=> clearTimeout(id); },[token, active, serverDown]);

  const wsFailureRef = useRef(0);
  const [usingSSE,setUsingSSE] = useState(false);
  const sseRef = useRef(null);

  const ws = useReconnectingWebSocket({
    url: () => `ws://localhost:4000/ws/agent-events?token=${token}`,
    enabled: !!token && active && !usingSSE,
    serverDown,
    debug: process.env.NODE_ENV !== 'production',
    onOpen: () => { setConnected(true); wsFailureRef.current = 0; markSuccess(); },
    onClose: () => {
      setConnected(false); markFailure();
      wsFailureRef.current++;
      if(wsFailureRef.current >= 5 && !usingSSE){
        // Activate SSE fallback
        try {
          const es = new EventSource(`http://localhost:4000/events/agent?token=${token}`);
          sseRef.current = es; setUsingSSE(true);
          es.onopen = () => { setConnected(true); };
          es.onerror = () => { /* keep retrying automatically by EventSource */ };
          es.addEventListener('hello', ev => { try { const data = JSON.parse(ev.data); if(data.metrics) setMetrics(data.metrics); } catch{} });
          es.addEventListener('event', ev => { try { const data = JSON.parse(ev.data); setEvents(prev=> { const next=[...prev, data]; return next.slice(-800); }); } catch{} });
        } catch{}
      }
    },
    onMessage: (_, msg) => {
      if(!msg) return;
      if(msg.type==='hello'){ if(msg.metrics) setMetrics(msg.metrics); }
      else if(msg.type==='event'){
        setEvents(prev=> { const next=[...prev, msg]; return next.slice(-800); });
      }
    }
  });
  useEffect(()=>{ return ()=> { try { sseRef.current && sseRef.current.close(); } catch{} }; },[]);

  // Derive currently selected task object (was missing after SSE patch causing ReferenceError)
  const selectedTask = useMemo(()=> tasks.find(t=> t.id===selectedTaskId) || null, [tasks, selectedTaskId]);

  // Filter events to selected task when possible (if payload includes task id fields)
  const taskEvents = useMemo(()=>{
    return events.filter(e=>{
      const payload = e.event || e; // shape may vary
      const idCandidate = payload.taskId || payload.task_id || payload.id || payload.task_id_ref;
      return !selectedTask || idCandidate===selectedTask.id;
    });
  },[events, selectedTask]);
  const visibleEvents = useMemo(()=> taskEvents.filter(e=> (!filterType || e.event?.type===filterType) && (!eventSearch || JSON.stringify(e).toLowerCase().includes(eventSearch.toLowerCase())) ), [taskEvents, filterType, eventSearch]);
  const distinctTypes = useMemo(()=> Array.from(new Set(taskEvents.map(e=> e.event?.type).filter(Boolean))).sort(), [taskEvents]);

  // Focus mode / sidebar collapse
  const [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const [metaMenuOpen,setMetaMenuOpen] = useState(false);
  useEffect(()=>{ if(!metaMenuOpen) return; const on=(e)=>{ if(!e.target.closest('.meta-menu')) setMetaMenuOpen(false); }; document.addEventListener('mousedown',on); return ()=> document.removeEventListener('mousedown',on); },[metaMenuOpen]);

  function send(){ if(!input.trim()||sending) return; if(serverDown){ setMessages(m=> [...m,{ role:'assistant', content:'Server offline. Try again shortly.' }]); return; } const prompt=input.trim(); setSending(true); setInput(''); setMessages(m=> [...m,{ role:'user', content:prompt }]); (async()=>{ const r=await agentChat(token,{ prompt, autoplan:autoPlan }); if(r.ok){ const d=r.data; setMessages(m=> [...m,{ role:'assistant', content:d.reply }]); if(d.plan && !d.executed) setLastSuggestedPlan(d.plan); else setLastSuggestedPlan([]); markSuccess(); } else { setMessages(m=> [...m,{ role:'assistant', content:r.error||'Error' }]); markFailure(); } setSending(false); })(); }
  function onKey(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } }
  function executeSuggested(){ if(!lastSuggestedPlan.length||sending) return; if(serverDown){ setMessages(m=> [...m,{ role:'assistant', content:'Server offline. Cannot execute plan.' }]); return; } setSending(true); const instruction = messages.slice().reverse().find(m=> m.role==='user')?.content || 'agent task'; (async()=>{ const r=await agentExecute(token,{ instruction, plan:lastSuggestedPlan }); if(r.ok){ setMessages(m=> [...m,{ role:'assistant', content:`Executing plan (${lastSuggestedPlan.length} steps).` }]); setLastSuggestedPlan([]); markSuccess(); } else { markFailure(); } setSending(false); })(); }

  /* --------------------------------------------------
     Autonomous Decision Loop Scaffold
     - Periodically evaluates current state & enqueues new tasks.
     - Non-intrusive: disabled by default; minimal heuristic.
  ---------------------------------------------------*/
  const [autoLoop,setAutoLoop] = useState(false);
  const [loopStatus,setLoopStatus] = useState('idle'); // idle | evaluating | action
  const [loopLog,setLoopLog] = useState([]);
  const loopSeqRef = useRef(0);
  function logLoop(msg){ setLoopLog(l=> { loopSeqRef.current++; return [...l.slice(-199), { ts:Date.now(), seq:loopSeqRef.current, msg }]; }); }
  // Expanded strategy options
  const [autoExec,setAutoExec] = useState(false); // auto execute plan if returned
  const lastActionRef = useRef(0);
  const LOOP_MIN_INTERVAL = 10000; // min 10s between cycles
  const LOOP_MAX_IDLE = 5; // after 5 idle cycles escalate prompt
  // Simple heuristic generator (placeholder for future strategy engine)
  const idleRef = useRef(0);
  function deriveStrategyInstruction(context){
    const activeTasks = context.tasks.filter(t=> ['queued','pending','waiting','running'].includes(t.status));
    if(activeTasks.length>0){ idleRef.current=0; return null; }
    // escalate prompt sophistication after repeated idle
    const basePrompts=[
      'Enumerate a lightweight recon scan (nmap fast) on scanme.nmap.org and summarize findings.',
      'Identify any failed tasks and suggest remediation steps.',
      'Propose a short prioritized list of follow-up security assessment tasks.'
    ];
    const advancedPrompts=[
      'Synthesize recent findings & propose next 3 high-value actions (nmap/nuclei or analysis).',
      'Assess task history and suggest one remediation and one exploratory action.'
    ];
    const useAdvanced = idleRef.current >= LOOP_MAX_IDLE;
    const pool = useAdvanced? [...basePrompts, ...advancedPrompts]: basePrompts;
    const pick = pool[Math.floor(Date.now()/45000)%pool.length];
    idleRef.current++;
    return pick;
  }
  useEffect(()=>{ if(!autoLoop||!token||!active) return; let cancelled=false; let timer; const cycle=async()=>{ if(cancelled) return; const now=Date.now(); if(now - lastActionRef.current < LOOP_MIN_INTERVAL){ timer=setTimeout(cycle, LOOP_MIN_INTERVAL - (now-lastActionRef.current)); return; }
      setLoopStatus('evaluating'); const context={ tasks }; const instruction=deriveStrategyInstruction(context); if(instruction){ setLoopStatus('action'); logLoop('Strategy: '+instruction); lastActionRef.current=Date.now(); const r=await agentChat(token,{ prompt:instruction, autoplan:true }); if(r.ok){ const d=r.data; logLoop('Chat reply len '+(d.reply?.length||0)); if(d.plan && !d.executed){ setLastSuggestedPlan(d.plan); logLoop('Plan suggested ('+d.plan.length+' steps)'); if(autoExec){ // auto execute entire plan
            const instr = instruction || 'autoplan';
            const ex = await agentExecute(token,{ instruction:instr, plan:d.plan });
            if(ex.ok) logLoop('Plan auto-executed'); else logLoop('Auto-exec failed');
          } }
          markSuccess();
        } else { logLoop('Chat error: '+(r.error||'err')); markFailure(); }
      } else { logLoop('Idle (active tasks present or none ready)'); }
      setLoopStatus('idle'); timer=setTimeout(cycle, 4000); };
    cycle(); return ()=> { cancelled=true; clearTimeout(timer); };
  },[autoLoop, autoExec, token, active, tasks]);
  // Smooth scroll newest chat message into view (guard for jsdom test env)
  useEffect(()=>{ bottomRef.current?.scrollIntoView?.({ behavior:'smooth' }); },[messages]);

  // Small Sparkline utility
  function Sparkline({ data=[], color='#4ea1ff', width=120, height=40 }){ const ref=useRef(null); useEffect(()=>{ if(!ref.current||!data.length) return; const c=ref.current, ctx=c.getContext('2d'); const w=c.width,h=c.height; ctx.clearRect(0,0,w,h); const max=Math.max(...data), min=Math.min(...data); ctx.beginPath(); ctx.strokeStyle=color; ctx.lineWidth=1.4; data.forEach((v,i)=>{ const x=(i/(data.length-1||1))*(w-4)+2; const norm=max===min? .5:(v-min)/(max-min); const y=h-2 - norm*(h-4); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.stroke(); },[data,color]); return <canvas ref={ref} width={width} height={height} style={{width:'100%', height: height}} />; }

  // Derive stat cards from summary (real data only)
  const statCards = useMemo(()=>{ if(!summary) return []; const tasksList = summary.tasks||[]; const activeTasks = tasksList.filter(t=> ['queued','pending','waiting','running'].includes(t.status)).length; const failedTasks = tasksList.filter(t=> t.status==='failed').length; const totalScans = (summary.scanCounts||[]).reduce((a,b)=> a + (b.count||0),0); // spark data
    let scanSpark=[]; if(summary.recentScans && summary.recentScans.length){ const withTs=summary.recentScans.map(s=> new Date(s.created_at||s.updated_at||s.ts||Date.now()).getTime()); const min=Math.min(...withTs), max=Math.max(...withTs); const span=max-min||1; const buckets=10; const arr=new Array(buckets).fill(0); withTs.forEach(ts=>{ const idx=Math.min(buckets-1, Math.floor(((ts-min)/span)*buckets)); arr[idx]++; }); scanSpark=arr; }
    const taskSpark = tasksList.slice(0,30).map(t=> ['running','queued','pending','waiting'].includes(t.status)?1:0);
    const cards=[ { label:'Active Tasks', value:activeTasks, accent:'#1f6feb', spark:taskSpark }, { label:'Total Scans', value:totalScans, accent:'#4ea1ff', spark:scanSpark }, ...(failedTasks>0? [{ label:'Failed Tasks', value:failedTasks, accent:'#d73a49' }]:[]) ]; return cards; },[summary]);

  // Helper components (reformatted for clarity)
  function Section({ title, children, defaultOpen = true, right, compact = false }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
      <div style={{ border:'1px solid #1d3547', borderRadius:10, background:'#0f1b24', padding: compact? '8px 10px':'10px 12px', marginBottom:14 }}>
        <div
          style={{ display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer' }}
          onClick={()=> setOpen(o=>!o)}
        >
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ transform: open? 'rotate(90deg)':'rotate(0deg)', transition:'transform .18s', fontSize:12, opacity:.7 }}>▶</span>
            <h3 style={{ margin:0, fontSize:14 }}>{title}</h3>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>{right}</div>
        </div>
        {open && <div style={{ marginTop:10 }}>{children}</div>}
      </div>
    );
  }

  function ScanTypesBar({ counts = [] }) {
    const total = counts.reduce((a,b)=> a + (b.count || 0), 0) || 1;
    const palette = ['#4ea1ff','#17c3b2','#7bda5d','#ffb347','#ff6b6b','#b084ff'];
    return (
      <div style={{ display:'flex', height:20, borderRadius:7, overflow:'hidden', border:'1px solid #163041', background:'#0d2735' }}>
        {counts.map((c,i)=>{
          const pct = (c.count / total) * 100;
          const bg = palette[i % palette.length];
            return (
              <div
                key={c.type}
                title={`${c.type}: ${c.count}`}
                style={{ width:pct+'%', background:bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#062030', fontWeight:600 }}
              >
                {pct > 8 ? c.type : ''}
              </div>
            );
        })}
      </div>
    );
  }

  function RecentScansTable({ scans = [], search }) {
    const [visible, setVisible] = useState(15);
    useEffect(()=>{ setVisible(15); }, [scans]);
    const filtered = useMemo(()=>{
      if(!search) return scans;
      const q = search.toLowerCase();
      return scans.filter(s=> (
        (s.id && s.id.toLowerCase().includes(q)) ||
        (s.type && s.type.toLowerCase().includes(q)) ||
        (s.target && s.target.toLowerCase().includes(q))
      ));
    }, [scans, search]);
    const slice = filtered.slice(0, visible);
    return (
      <div style={{ marginTop:4, flex:1, display:'flex', flexDirection:'column' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="mini-table" style={{ minWidth:520 }}>
            <thead>
              <tr><th style={{width:90}}>ID</th><th>Type</th><th>Target</th><th>Status</th></tr>
            </thead>
            <tbody>
              {slice.map(s=>{
                const statusColor = STATUS_COLORS[s.status] || '#546372';
                return (
                  <tr key={s.id} title={s.id}>
                    <td>{s.id.slice(0,8)}</td>
                    <td>{s.type}</td>
                    <td style={{ maxWidth:260, overflow:'hidden', textOverflow:'ellipsis' }} title={s.target}>{s.target}</td>
                    <td>
                      <span style={{ fontSize:10, background: statusColor+'22', color:statusColor, padding:'2px 6px', borderRadius:12, fontWeight:600 }}>{s.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:6 }}>
          <div style={{ fontSize:10, opacity:.55 }}>{slice.length} shown • {filtered.length} filtered • {scans.length} total</div>
          {slice.length < filtered.length && (
            <button
              onClick={()=> setVisible(v=> v + 15)}
              style={{ fontSize:11, background:'#12384f', color:'#cfe8f7', border:'1px solid #1d4b66', padding:'4px 12px', borderRadius:14 }}
            >
              Load more
            </button>
          )}
        </div>
      </div>
    );
  }

  function TaskList({ tasks = [], search }) {
    const [filter, setFilter] = useState('active');
    const [visible, setVisible] = useState(20);
    useEffect(()=>{ setVisible(20); }, [filter, tasks]);
    const baseFiltered = useMemo(()=>{
      let list = [...tasks];
      if(filter === 'active') list = list.filter(t=> ['queued','pending','waiting','running'].includes(t.status));
      else if(filter === 'failed') list = list.filter(t=> t.status === 'failed');
      else if(filter === 'recent') list = list.slice(0,30);
      return list;
    }, [tasks, filter]);
    const searched = useMemo(()=>{
      if(!search) return baseFiltered;
      const q = search.toLowerCase();
      return baseFiltered.filter(t=> (
        (t.instruction && t.instruction.toLowerCase().includes(q)) ||
        (t.id && t.id.toLowerCase().includes(q))
      ));
    }, [baseFiltered, search]);
    const slice = searched.slice(0, visible);
    const filters = ['active','recent','failed','all'];
    return (
      <div style={{ display:'flex', flexDirection:'column' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <h3 style={{ margin:0, fontSize:14 }}>Tasks</h3>
          <div style={{ display:'flex', gap:6 }}>
            {filters.map(f=>{
              const act = f === filter;
              return (
                <button
                  key={f}
                  onClick={()=> setFilter(f)}
                  style={{ fontSize:10, padding:'4px 10px', borderRadius:14, border:'1px solid '+(act?'#2d5b89':'#1d3547'), background: act?'#12384f':'#0e2735', color:'#cfe8f7' }}
                >{f}</button>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize:10, opacity:.55, marginBottom:6 }}>
          {slice.length} shown • {searched.length} filtered • {baseFiltered.length} base • {tasks.length} total
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {!slice.length && <div style={{ fontSize:11, opacity:.5 }}>No tasks.</div>}
          {slice.map(t=>{
            const color = STATUS_COLORS[t.status] || '#888';
            const isRunning = t.status === 'running';
            const isQueued = ['queued','pending','waiting'].includes(t.status);
            const created = t.created_at? new Date(t.created_at).getTime(): null;
            const updated = t.updated_at? new Date(t.updated_at).getTime(): null;
            const elapsedMs = (created && updated)? (updated - created): null;
            const elapsed = elapsedMs? (elapsedMs/1000 < 60? Math.round(elapsedMs/1000)+'s': Math.round(elapsedMs/60000)+'m'): '';
            return (
              <div
                key={t.id}
                style={{ display:'flex', flexDirection:'column', gap:6, background:'#111d28', border:'1px solid #162633', borderRadius:12, padding:'8px 10px' }}
                onClick={()=> setSelectedTaskId(t.id)}
              >
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:16, height:16 }}>
                    {isRunning && <div style={{ width:16, height:16, borderRadius:'50%', border:'2px solid '+color, borderTopColor:'transparent', animation:'spin .8s linear infinite' }} />}
                    {isQueued && !isRunning && <div style={{ width:16, height:16, borderRadius:'50%', background:color+'33', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:color }}>⏱</div>}
                    {t.status==='completed' && <div style={{ width:16, height:16, borderRadius:'50%', background:color+'33', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:color }}>✔</div>}
                    {t.status==='failed' && <div style={{ width:16, height:16, borderRadius:'50%', background:color+'33', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:color }}>✖</div>}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      {t.instruction && (
                        <div
                          style={{ fontSize:11, fontWeight:500, maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                          title={t.instruction}
                        >{t.instruction}</div>
                      )}
                      <span style={{ fontSize:10, background: color+'22', color, padding:'2px 6px', borderRadius:12, fontWeight:600, textTransform:'uppercase' }}>{t.status}</span>
                      {elapsed && <span style={{ fontSize:10, opacity:.55 }}>{elapsed}</span>}
                      <code style={{ fontSize:10, opacity:.5 }} title={t.id}>{t.id.slice(0,8)}</code>
                    </div>
                    {isRunning && (
                      <div style={{ height:4, borderRadius:2, background:'#0d2533', marginTop:6, overflow:'hidden' }}>
                        <div style={{ width:'60%', height:'100%', background:color, animation:'pulse-width 2s ease-in-out infinite', opacity:.85 }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {slice.length < baseFiltered.length && (
          <button
            onClick={()=> setVisible(v=> v + 20)}
            style={{ marginTop:12, alignSelf:'flex-start', fontSize:11, background:'#12384f', color:'#cfe8f7', border:'1px solid #1d4b66', padding:'6px 14px', borderRadius:16 }}
          >
            Load more
          </button>
        )}
      </div>
    );
  }

  function FindingsList({ data = [], search }) {
    const [visible, setVisible] = useState(40);
    useEffect(()=>{ setVisible(40); }, [data]);
    const filtered = useMemo(()=>{
      if(!search) return data;
      const q = search.toLowerCase();
      return data.filter(f=> (
        (f.title && f.title.toLowerCase().includes(q)) ||
        (f.target && f.target.toLowerCase().includes(q)) ||
        (f.severity && f.severity.toLowerCase().includes(q))
      ));
    }, [data, search]);
    const slice = filtered.slice(0, visible);
    return (
      <div>
        <table className="mini-table">
          <thead>
            <tr><th style={{width:140}}>Target</th><th>Title</th><th style={{width:100}}>Severity</th></tr>
          </thead>
          <tbody>
            {slice.map(f=>{
              const sevColor = SEVERITY_COLORS[f.severity?.toLowerCase()] || '#546372';
              return (
                <tr key={f.id+f.ts}>
                  <td style={{ maxWidth:140, overflow:'hidden', textOverflow:'ellipsis' }} title={f.target}>{f.target}</td>
                  <td style={{ maxWidth:360, overflow:'hidden', textOverflow:'ellipsis' }} title={f.title}>{f.title}</td>
                  <td><span style={{ fontSize:10, background: sevColor+'22', color:sevColor, padding:'2px 8px', borderRadius:12, fontWeight:600, textTransform:'uppercase' }}>{f.severity}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:8 }}>
          <div style={{ fontSize:10, opacity:.55 }}>{slice.length} shown • {filtered.length} filtered • {data.length} total</div>
            {slice.length < filtered.length && (
              <button className="btn tiny" onClick={()=> setVisible(v=> v + 40)}>Load more</button>
            )}
        </div>
      </div>
    );
  }

  function ActivityFeed({ summary }) {
    if(!summary) return null;
    const events = [];
    (summary.tasks||[]).slice(0,80).forEach(t=>{
      const ts = new Date(t.updated_at||t.created_at||Date.now()).getTime();
      events.push({ ts, type:'task', status:t.status, label:t.instruction||'Task', id:t.id });
    });
    (summary.recentScans||[]).slice(0,80).forEach(s=>{
      const ts = new Date(s.updated_at||s.created_at||s.ts||Date.now()).getTime();
      events.push({ ts, type:'scan', status:s.status, label:s.type+' → '+(s.target||''), id:s.id });
    });
    events.sort((a,b)=> b.ts - a.ts);
    const limited = events.slice(0,40);
    if(!limited.length) return <div style={{ fontSize:12, opacity:.5 }}>No recent activity.</div>;
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {limited.map(e=>{
          const color = STATUS_COLORS[e.status] || '#4ea1ff';
          return (
            <div
              key={e.type+e.id+e.ts}
              style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, background:'#111d28', padding:'6px 8px', border:'1px solid #162633', borderRadius:8 }}
            >
              <span style={{ width:8, height:8, borderRadius:'50%', background:color }} />
              <div style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={e.label}>{e.label}</div>
              <span style={{ fontSize:10, background:color+'22', color:color, padding:'2px 6px', borderRadius:10, fontWeight:600 }}>{e.type}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // Downloads helper
  const dl = (path)=> {
    const a = document.createElement('a');
    a.href = `http://localhost:4000/api/ai${path}?t=${Date.now()}`;
    a.setAttribute('download','');
    a.setAttribute('target','_blank');
    a.click();
  };

  // Timeseries charts
  function LineChart({ series, color = '#4ea1ff' }) {
    const ref = useRef(null);
    useEffect(()=>{
      if(!ref.current || !series?.length) return;
      const c = ref.current, ctx = c.getContext('2d');
      const w = c.width, h = c.height;
      ctx.clearRect(0,0,w,h);
      const max = Math.max(1, ...series.map(p=> p.total));
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      series.forEach((p,i)=>{
        const x = (i/(series.length-1))*(w-10)+5;
        const y = h-5 - (p.total/max)*(h-20);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      });
      ctx.stroke();
      ctx.fillStyle = color;
      series.forEach((p,i)=>{
        const x = (i/(series.length-1))*(w-10)+5;
        const y = h-5 - (p.total/max)*(h-20);
        ctx.beginPath();
        ctx.arc(x,y,3,0,Math.PI*2);
        ctx.fill();
      });
    }, [series, color]);
    return <canvas ref={ref} width={360} height={120} style={{ width:'100%', height:120 }} />;
  }

  function StackedChart({ series }) {
    const ref = useRef(null);
    const keys = useMemo(()=>{
      const set = new Set();
      series.forEach(s=> Object.keys(s.byType||{}).forEach(k=> set.add(k)));
      return Array.from(set).sort();
    }, [series]);
    useEffect(()=>{
      if(!ref.current || !series?.length) return;
      const c = ref.current, ctx = c.getContext('2d');
      const w = c.width, h = c.height;
      ctx.clearRect(0,0,w,h);
      const palette=['#4ea1ff','#7bda5d','#ffb347','#ff6b6b','#b084ff','#17c3b2','#ffa600'];
      const max = Math.max(1, ...series.map(p=> Object.values(p.byType||{}).reduce((a,b)=> a+b,0)));
      series.forEach((point,idx)=>{
        const x=(idx/(series.length-1))*(w-40)+20;
        let yBase = h-20;
        let colorIndex=0;
        keys.forEach(k=>{
          const v=(point.byType||{})[k]||0;
          if(!v) return;
          const barHeight=(v/max)*(h-40);
          ctx.fillStyle=palette[colorIndex%palette.length];
          colorIndex++;
          ctx.fillRect(x-8, yBase-barHeight, 16, barHeight);
          yBase -= barHeight;
        });
        if(idx % Math.ceil(series.length/8)===0){
          ctx.fillStyle='#888';
          ctx.font='10px sans-serif';
          ctx.fillText(new Date(point.ts).getHours()+':00', x-14, h-5);
        }
      });
      ctx.font='10px sans-serif';
      keys.forEach((k,i)=>{
        ctx.fillStyle=palette[i%palette.length];
        ctx.fillRect(w-90, 6+i*12,10,10);
        ctx.fillStyle='#ccc';
        ctx.fillText(k, w-75, 15+i*12);
      });
    }, [series, keys]);
    return <canvas ref={ref} width={360} height={140} style={{ width:'100%', height:140 }} />;
  }

  if(!active) return null;

  // Local task search (client-side) & status filter
  const [taskSearch,setTaskSearch] = useState('');
  const [taskFilter,setTaskFilter] = useState('all'); // all | active | failed | completed
  const filteredTasks = useMemo(()=>{
    let list = tasks;
    if(taskFilter==='active') list = list.filter(t=> ['queued','pending','waiting','running'].includes(t.status));
    else if(taskFilter==='failed') list = list.filter(t=> t.status==='failed');
    else if(taskFilter==='completed') list = list.filter(t=> t.status==='completed');
    if(taskSearch){ const q = taskSearch.toLowerCase(); list = list.filter(t=> (t.instruction||'').toLowerCase().includes(q) || (t.id||'').toLowerCase().includes(q)); }
    return list.slice(0,500); // cap render for perf
  },[tasks, taskSearch, taskFilter]);

  return (
    <div style={{display:'flex', height:'100%', position:'relative'}}>
      {/* Pane 1: Task History Sidebar (collapsible) */}
      <div style={{width: sidebarCollapsed? 0:250, transition:'width .25s', overflow:'hidden', borderRight: sidebarCollapsed? 'none':'1px solid #15222e', display:'flex', flexDirection:'column', background:'#0d1620', position:'relative'}}>
        {!sidebarCollapsed && <>
        <div style={{padding:'8px 10px', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #15222e'}}>
          <strong style={{fontSize:12, flex:1}}>Tasks</strong>
          <button className="btn accent tiny" style={{fontSize:10, fontWeight:600}} title="New Task" onClick={()=> { setSelectedTaskId(null); setMessages([]); setInput(''); }}>+ New</button>
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:6, padding:'8px 8px 4px'}}>
          <input value={taskSearch} onChange={e=> setTaskSearch(e.target.value)} placeholder="Search tasks" style={{fontSize:11, padding:'4px 8px', borderRadius:6, border:'1px solid #1d3547', background:'#0f1b24', color:'#cfe8f7'}} />
          <select value={taskFilter} onChange={e=> setTaskFilter(e.target.value)} style={{fontSize:11, padding:'4px 6px', borderRadius:6, border:'1px solid #1d3547', background:'#0f1b24', color:'#cfe8f7'}}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <div style={{fontSize:10, opacity:.55}}>{filteredTasks.length} / {tasks.length} tasks</div>
        </div>
        <div style={{flex:1, overflowY:'auto'}} data-testid="task-list">
          {filteredTasks.map(t=>{
            const activeSel = t.id===selectedTaskId;
            const statusColor = STATUS_COLORS[t.status] || '#1d2f3a';
            const icon = t.status==='completed'? '✔': t.status==='failed'? '✖': (['running'].includes(t.status)? '⟳': (['queued','pending','waiting'].includes(t.status)? '⏱':'•'));
            return <div key={t.id} onClick={()=> setSelectedTaskId(t.id)} style={{padding:'6px 9px 7px', cursor:'pointer', background: activeSel? '#12384f':'transparent', borderLeft: activeSel? '3px solid #2d5b89':'3px solid transparent', borderBottom:'1px solid #14212e', display:'flex', flexDirection:'column', gap:2}}>
              <div style={{display:'flex', alignItems:'center', gap:6, fontSize:10}}>
                <span style={{width:14, textAlign:'center', color:statusColor, fontSize:11}}>{icon}</span>
                <span style={{fontSize:9, background:statusColor+'33', color:statusColor, padding:'2px 5px', borderRadius:8, textTransform:'uppercase', fontWeight:600}}>{t.status}</span>
                <code style={{fontSize:9, opacity:.45}}>{t.id.slice(0,6)}</code>
              </div>
              <div style={{fontSize:11, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={t.instruction}>{t.instruction||'Task'}</div>
            </div>;
          })}
          {!filteredTasks.length && <div style={{padding:12, fontSize:11, opacity:.6}}>No tasks.</div>}
        </div>
        {/* Tool catalog quick list */}
        <div style={{padding:'8px 10px', borderTop:'1px solid #14212e', maxHeight:132, overflowY:'auto'}}>
          <div style={{fontSize:11, opacity:.7, marginBottom:4}}>Tools</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
            {tools.map(t=> <span key={t.id} title={t.description} style={{fontSize:9, background:'#101d27', padding:'3px 6px', borderRadius:12}}>{t.id}</span>)}
            {!tools.length && <span style={{fontSize:10, opacity:.5}}>Loading…</span>}
          </div>
        </div>
        </>}
        {/* Collapse toggle */}
        <button onClick={()=> setSidebarCollapsed(c=>!c)} title={sidebarCollapsed? 'Expand tasks':'Collapse tasks'} style={{position:'absolute', top:6, right: sidebarCollapsed? -14: -12, width:24, height:24, borderRadius: sidebarCollapsed? '0 6px 6px 0':'50%', background:'#0f1b24', border:'1px solid #1d3547', color:'#8fb8d4', fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 4px -1px #0008'}}>{sidebarCollapsed? '›':'‹'}</button>
      </div>

      {/* Pane 2: Main Workspace (now full width when collapsed) */}
      <div style={{flex:1, display:'flex', flexDirection:'column', position:'relative'}}>
        {serverDown && <div style={{position:'absolute', top:4, right:8, zIndex:30, background:'#402020', color:'#f6d6d6', padding:'6px 10px', border:'1px solid #5a2a2a', borderRadius:8, fontSize:11, display:'flex', alignItems:'center', gap:10}}>
          <span>Server unreachable. Retrying…</span>
          <button onClick={async()=>{ try { const d=await safeFetch('/api/ai/health',{ token, retries:0 }); if(d.ok){ markSuccess(); } else { markFailure(); } } catch { markFailure(); } }} className="btn tiny" style={{background:'#5a2a2a', border:'1px solid #804040', color:'#f6d6d6'}}>
            Retry now
          </button>
        </div>}
        {/* Consolidated header with metadata & overflow */}
        <div style={{padding:'6px 12px', display:'flex', alignItems:'center', gap:14, borderBottom:'1px solid #15222e', background:'#0f1b24'}}>
          {selectedTask ? (
            <>
              <div style={{display:'flex', flexDirection:'column', gap:2, minWidth:0}}>
                <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
                  <h3 style={{margin:0, fontSize:14, maxWidth:520, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={selectedTask.instruction}>{selectedTask.instruction||'Task'}</h3>
                  <span style={{fontSize:10, background:(STATUS_COLORS[selectedTask.status]||'#1d2f3a')+'33', color:STATUS_COLORS[selectedTask.status]||'#cfe8f7', padding:'2px 8px', borderRadius:14, fontWeight:600, textTransform:'uppercase'}}>{selectedTask.status}</span>
                  <code style={{fontSize:10, opacity:.55}}>{selectedTask.id.slice(0,8)}</code>
                  <div className="meta-menu" style={{position:'relative'}}>
                    <button className="btn tiny" style={{fontSize:10}} onClick={()=> setMetaMenuOpen(o=>!o)}>⋯</button>
                    {metaMenuOpen && <div style={{position:'absolute', top:'110%', left:0, background:'#0f1b24', border:'1px solid #1d3547', borderRadius:8, padding:8, display:'flex', flexDirection:'column', gap:6, minWidth:190, zIndex:10}}>
                      <div style={{fontSize:10, opacity:.65}}>Created: {selectedTask.created_at? new Date(selectedTask.created_at).toLocaleString(): '—'}</div>
                      <div style={{fontSize:10, opacity:.65}}>Updated: {selectedTask.updated_at? new Date(selectedTask.updated_at).toLocaleString(): '—'}</div>
                      <div style={{fontSize:10, opacity:.65}}>Messages: {messages.length}</div>
                      <div style={{fontSize:10, opacity:.65}}>Events: {taskEvents.length}</div>
                      <div style={{fontSize:10, opacity:.65}}>Task ID: {selectedTask.id}</div>
                      {binaries && <div style={{fontSize:10, opacity:.7}}>nmap: <strong style={{color: binaries.nmap?.ok? '#5fbf60':'#bf5f5f'}}>{binaries.nmap?.ok? 'ok':'missing'}</strong> • nuclei: <strong style={{color: binaries.nuclei?.ok? '#5fbf5f':'#bf5f5f'}}>{binaries.nuclei?.ok? 'ok':'missing'}</strong></div>}
                    </div>}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{fontSize:12, opacity:.6}}>Create a new task or select one to begin.</div>
          )}
          <div style={{flex:1}} />
          {binaries && selectedTask && <span style={{fontSize:10, opacity:.65}}>nmap:<strong style={{color: binaries.nmap?.ok? '#5fbf60':'#bf5f5f'}}> {binaries.nmap?.ok? 'ok':'miss'}</strong> • nuclei:<strong style={{color: binaries.nuclei?.ok? '#5fbf5f':'#bf5f5f'}}> {binaries.nuclei?.ok? 'ok':'miss'}</strong></span>}
        </div>
        <div style={{display:'flex', gap:10, padding:'8px 12px', borderBottom:'1px solid #15222e', background:'#0f1b24', flexWrap:'wrap'}}>
          {['chat','events','summary','scans','findings'].map(t=> <button key={t} onClick={()=> setTab(t)} style={{
            padding:'6px 14px', fontSize:12, borderRadius:16, cursor:'pointer',
            background: tab===t? 'linear-gradient(135deg,#124364,#0d2635)':'#101d27',
            border:'1px solid '+(tab===t? '#2d5b89':'#1d3547'), color:'#cfe8f7'
          }}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>)}
          <div style={{flex:1}} />
          {/* Autonomous loop toggle */}
          <label title="Autonomous strategy loop" style={{display:'flex', alignItems:'center', gap:6, fontSize:11, background:autoLoop?'#12384f':'#101d27', padding:'4px 10px', border:'1px solid '+(autoLoop?'#2d5b89':'#1d3547'), borderRadius:18, cursor:'pointer'}}>
            <input type="checkbox" checked={autoLoop} onChange={e=> setAutoLoop(e.target.checked)} /> Auto Loop
          </label>
          {autoLoop && <label title="Auto execute generated plan" style={{display:'flex', alignItems:'center', gap:4, fontSize:11, background:autoExec?'#124364':'#101d27', padding:'4px 10px', border:'1px solid '+(autoExec?'#2d5b89':'#1d3547'), borderRadius:18, cursor:'pointer'}}>
            <input type="checkbox" checked={autoExec} onChange={e=> setAutoExec(e.target.checked)} /> Auto Exec
          </label>}
          {/* Global search + downloads on report tabs */}
          {['summary','scans','findings'].includes(tab) && <div style={{display:'flex', alignItems:'center', gap:10}}>
            <div style={{position:'relative'}}>
              <span style={{position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', fontSize:13, opacity:.55}}>🔍</span>
              <input value={globalSearch} onChange={e=> setGlobalSearch(e.target.value)} placeholder="Search..." style={{background:'#0d2735', border:'1px solid #1d3547', borderRadius:18, padding:'6px 30px 6px 26px', fontSize:12, width:190, color:'#cfe8f7'}} />
            </div>
            <div style={{position:'relative'}} className="dl-menu">
              <button className="btn small" style={{background:'transparent', border:'1px solid #1d3547', color:'#cfe8f7'}} onClick={()=> setDlOpen(o=> !o)}>Download ▾</button>
              {dlOpen && <div style={{position:'absolute', right:0, top:'110%', background:'#0f1b24', border:'1px solid #1d3547', borderRadius:8, padding:6, display:'flex', flexDirection:'column', minWidth:170, zIndex:5, boxShadow:'0 4px 14px -2px #000a'}}>
                <button className="btn tiny" style={{textAlign:'left'}} onClick={()=> dl('/export/tasks.csv')}>Tasks CSV</button>
                <button className="btn tiny" style={{textAlign:'left'}} onClick={()=> dl('/export/scans.csv')}>Scans CSV</button>
                <button className="btn tiny" style={{textAlign:'left'}} onClick={()=> dl('/export/findings.csv')}>Findings CSV</button>
              </div>}
            </div>
          </div>}
          {selectedTask && <div style={{fontSize:11, opacity:.7, display:'flex', alignItems:'center', gap:8}}>Task: <code style={{fontSize:10}}>{selectedTask.id.slice(0,8)}</code><span style={{fontSize:10, background:'#1d2f3a', padding:'2px 6px', borderRadius:10}}>{selectedTask.status}</span></div>}
          {autoLoop && <div style={{fontSize:10, opacity:.65}}>Loop: {loopStatus}</div>}
        </div>

        {/* Chat Tab (messages + input flow) */}
    {tab==='chat' && <div style={{flex:1, display:'flex', flexDirection:'column', padding:'10px 14px 12px', gap:10, overflow:'hidden'}}>
          {!llmReady && <div style={{background:'#402020', color:'#f6d6d6', padding:'6px 10px', borderRadius:8, fontSize:11}}>LLM disabled: set GEMINI_API_KEY on backend.</div>}
          {autoLoop && loopLog.length>0 && <div style={{fontSize:10, maxHeight:120, overflowY:'auto', background:'#101a24', border:'1px solid #1d3547', borderRadius:8, padding:'4px 6px', lineHeight:1.3}}>
            {loopLog.slice(-6).map(l=> <div key={l.ts+'-'+l.seq}>{new Date(l.ts).toLocaleTimeString()} • {l.msg}</div>)}
          </div>}
          <div style={{flex:1, overflowY:'auto', paddingRight:6}}>
            <div style={{display:'flex', flexDirection:'column', gap:10}}>
      {/* Clear chat button near messages for context */}
      {messages.length>0 && <button onClick={()=> setMessages([])} title="Clear chat" style={{alignSelf:'flex-end', background:'transparent', border:'1px solid #1d3547', color:'#8fb8d4', fontSize:10, padding:'2px 6px', borderRadius:8, cursor:'pointer'}}>Clear</button>}
              {messages.map((m,i)=> <div key={i} style={{alignSelf: m.role==='user'? 'flex-end':'flex-start', background: m.role==='user'? 'var(--accent)':'#16202c', color:m.role==='user'? '#fff':'var(--text)', padding:'8px 12px', borderRadius:14, maxWidth:'70%', fontSize:12, whiteSpace:'pre-wrap'}}>{m.content}</div>)}
              {!messages.length && <div style={{fontSize:12, opacity:.6}}>Ask the agent to enumerate a host. Example: "Scan and assess scanme.nmap.org"</div>}
              {/* Input anchored directly after messages */}
              <div style={{display:'flex', gap:8, marginTop:4}}>
                <textarea value={input} onChange={e=> setInput(e.target.value)} onKeyDown={onKey} placeholder="Type instruction..." style={{flex:1, minHeight:70, resize:'none'}} />
                <div style={{display:'flex', flexDirection:'column', gap:6}}>
                  <button className="btn accent" disabled={sending} onClick={send} style={{height:38, minWidth:90}}>{sending? '...' : 'Send'}</button>
                  <label style={{fontSize:11, display:'flex', gap:4, alignItems:'center'}}><input type="checkbox" checked={autoPlan} onChange={e=> setAutoPlan(e.target.checked)} /> Auto Plan</label>
                </div>
              </div>
              {lastSuggestedPlan.length>0 && <div style={{background:'#101a24', padding:10, borderRadius:10}}>
                <div style={{fontSize:12, fontWeight:600, marginBottom:4}}>Suggested Plan ({lastSuggestedPlan.length})</div>
                <ol style={{fontSize:11, paddingLeft:18, margin:0}}>{lastSuggestedPlan.map((s,i)=> <li key={i}><code>{s.tool}</code> {s.args? JSON.stringify(s.args):''}</li>)}</ol>
                <div style={{marginTop:6, display:'flex', gap:8}}>
                  <button className="btn tiny" onClick={executeSuggested}>Execute Plan</button>
                  <button className="btn tiny" onClick={()=> setLastSuggestedPlan([])}>Dismiss</button>
                </div>
              </div>}
              <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
                {tools.slice(0,12).map(t=> <span key={t.id} style={{fontSize:10, background:'#101a24', padding:'4px 8px', borderRadius:20}}>{t.id}</span>)}
              </div>
              <div ref={bottomRef} />
            </div>
          </div>
        </div>}

        {/* Events Tab */}
        {tab==='events' && <div style={{flex:1, display:'flex', flexDirection:'column', padding:14, gap:10}}>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <h3 style={{margin:0, fontSize:14}}>Live Events</h3>
            <label style={{fontSize:11, display:'flex', gap:4, alignItems:'center'}}><input type="checkbox" checked={follow} onChange={e=> setFollow(e.target.checked)} /> Follow</label>
            <select value={filterType} onChange={e=> setFilterType(e.target.value)} style={{fontSize:11}}>
              <option value="">All Types</option>
              {distinctTypes.map(t=> <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={eventSearch} onChange={e=> setEventSearch(e.target.value)} placeholder="Search" style={{fontSize:11, padding:'4px 6px', width:150}} />
            <div style={{flex:1}} />
            <span style={{fontSize:11, opacity:.65}}>Conn: {connected? <span style={{color:'#5fbf60'}}>●</span>: <span style={{color:'#bf5f5f'}}>●</span>}</span>
          </div>
          <div ref={eventsScrollRef} style={{flex:1, overflowY:'auto', background:'#0f1820', border:'1px solid #14212e', borderRadius:8, fontSize:11, padding:6, lineHeight:1.35}}>
            {visibleEvents.map((e,i)=> <div key={i} style={{padding:'2px 4px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', gap:8}}>
              <span style={{opacity:.55, minWidth:72}}>{new Date(e.ts||Date.now()).toLocaleTimeString()}</span>
              <span style={{color:'#58a6ff', minWidth:120}}>{e.event?.type||'event'}</span>
              <span style={{flex:1, whiteSpace:'pre-wrap', fontFamily:'var(--font-mono)', overflowWrap:'anywhere'}}>{JSON.stringify(e.event)}</span>
            </div>)}
            {!visibleEvents.length && <div style={{opacity:.6}}>No events for this task.</div>}
          </div>
          <div style={{fontSize:10, opacity:.6}}>Showing {visibleEvents.length} / {taskEvents.length} task events.</div>
        </div>}

        {/* Summary Tab */}
        {tab==='summary' && <div style={{flex:1, display:'flex', flexDirection:'column', padding:14, gap:14, overflowY:'auto'}}>
          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <h3 style={{margin:0, fontSize:14}}>Summary & Activity</h3>
            <label style={{fontSize:11, display:'flex', alignItems:'center', gap:6, background:'rgba(255,255,255,0.04)', padding:'4px 10px', borderRadius:14}}><input type="checkbox" checked={compact} onChange={e=> setCompact(e.target.checked)} /> Compact</label>
          </div>
          {summaryLoading && <div className="skeleton-line" style={{width:'40%'}} />}
          {summaryError && <div className="form-error" style={{fontSize:12}}>{summaryError}</div>}
          {summary && !compact && <div>
            <div style={{display:'grid', gap:14, gridTemplateColumns:`repeat(auto-fit,minmax(${statCards.length>2?150:170}px,1fr))`, marginBottom:16}}>
              {statCards.map(c=> <div key={c.label} style={{background:'linear-gradient(145deg,#0d2735,#0b1d28)', border:'1px solid #163041', borderRadius:14, padding:'10px 12px', position:'relative', overflow:'hidden', display:'flex', flexDirection:'column', gap:4}}>
                <div style={{position:'absolute', inset:0, background:`radial-gradient(circle at 75% 20%, ${c.accent}22, transparent 65%)`}} />
                <div style={{fontSize:11, opacity:.65, letterSpacing:.5}}>{c.label}</div>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:6}}>
                  <div style={{fontSize:24, fontWeight:600, color:c.accent}}>{c.value}</div>
                  {c.spark && c.spark.length>1 && <div style={{width:90}}><Sparkline data={c.spark} color={c.accent} width={90} height={32} /></div>}
                </div>
              </div>)}
            </div>
            <Section title="Scan Types" defaultOpen={false} compact>{summary.scanCounts?.length? <div style={{display:'flex', flexDirection:'column', gap:10}}><ScanTypesBar counts={summary.scanCounts} /><table className="mini-table"><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>{summary.scanCounts.map(r=> <tr key={r.type}><td>{r.type}</td><td>{r.count}</td></tr>)}</tbody></table></div>: <div style={{fontSize:12, opacity:.5}}>No scans.</div>}</Section>
            <Section title="Recent Activity" defaultOpen={false}><ActivityFeed summary={summary} /></Section>
            <Section title="Tasks" defaultOpen={false}><TaskList tasks={summary.tasks||[]} search={globalSearch} /></Section>
            <Section title="Recent Scans" defaultOpen={false}><RecentScansTable scans={summary.recentScans||[]} search={globalSearch} /></Section>
          </div>}
          {summary && compact && <div style={{marginTop:4}}>
            <div style={{display:'grid', gap:14, gridTemplateColumns:`repeat(auto-fit,minmax(${statCards.length>2?150:170}px,1fr))`}}>
              {statCards.map(c=> <div key={c.label} style={{background:'linear-gradient(145deg,#0d2735,#0b1d28)', border:'1px solid #163041', borderRadius:14, padding:'10px 12px', position:'relative'}}><div style={{fontSize:11, opacity:.65}}>{c.label}</div><div style={{fontSize:24, fontWeight:600, color:c.accent}}>{c.value}</div></div>)}
            </div>
          </div>}
        </div>}

        {/* Scans Tab */}
        {tab==='scans' && <div style={{flex:1, display:'flex', flexDirection:'column', padding:14, gap:14, overflowY:'auto'}}>
          {summary && <Section title="Counts" defaultOpen={true}>{summary.scanCounts?.length? <table className="mini-table"><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>{summary.scanCounts.map(r=> <tr key={r.type}><td>{r.type}</td><td>{r.count}</td></tr>)}</tbody></table>: <div style={{fontSize:12, opacity:.5}}>No scans.</div>}</Section>}
          <Section title="Volume & Trends" defaultOpen={false} right={<button className="btn tiny" onClick={(e)=>{ e.stopPropagation(); setTsFilters({ hours:48, types:'', target:'' }); }}>Reset</button>}>
            <div style={{display:'flex', flexDirection:'column', gap:10}}>
              <div style={{display:'flex', gap:10, flexWrap:'wrap'}}>
                <label style={{fontSize:11}}>Hours <input type="number" min={1} max={336} value={tsFilters.hours} onChange={e=> setTsFilters(f=>({...f, hours:e.target.value}))} style={{width:70}} /></label>
                <label style={{fontSize:11}}>Types <input type="text" placeholder="nmap,nuclei" value={tsFilters.types} onChange={e=> setTsFilters(f=>({...f, types:e.target.value}))} style={{width:140}} /></label>
                <label style={{fontSize:11}}>Target <input type="text" placeholder="substr" value={tsFilters.target} onChange={e=> setTsFilters(f=>({...f, target:e.target.value}))} style={{width:160}} /></label>
              </div>
              {(debouncedTs.types || debouncedTs.target) && <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                {debouncedTs.types && <span style={{fontSize:10, background:'rgba(255,255,255,0.08)', padding:'2px 6px', borderRadius:12}}>types: {debouncedTs.types}</span>}
                {debouncedTs.target && <span style={{fontSize:10, background:'rgba(255,255,255,0.08)', padding:'2px 6px', borderRadius:12}}>target: {debouncedTs.target}</span>}
              </div>}
              {loadingTs && <div className="skeleton-line" style={{width:'50%'}} />}
              {ts && ts.series?.length>0 && <div style={{position:'relative'}}><div style={{position:'absolute', top:0, right:0}}><label style={{fontSize:11, display:'flex', alignItems:'center', gap:4}}><input type="checkbox" checked={stacked} onChange={e=> setStacked(e.target.checked)} /> Stacked</label></div>{!stacked && <LineChart series={ts.series} />}{stacked && <StackedChart series={ts.series} />}</div>}
            </div>
          </Section>
          {summary && <Section title="Recent Scans" defaultOpen={true}><RecentScansTable scans={summary.recentScans||[]} search={globalSearch} /></Section>}
        </div>}

        {/* Findings Tab */}
        {tab==='findings' && <div style={{flex:1, display:'flex', flexDirection:'column', padding:14, gap:14, overflowY:'auto'}}>
          <Section title="Filters" defaultOpen={false} compact>
            <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
              <label style={{fontSize:11}}>Severity <input type="text" placeholder="critical,high" value={findingFilters.severity} onChange={e=> setFindingFilters(f=>({...f, severity:e.target.value}))} style={{width:140}} /></label>
              <label style={{fontSize:11}}>Target <input type="text" placeholder="substr" value={findingFilters.target} onChange={e=> setFindingFilters(f=>({...f, target:e.target.value}))} style={{width:160}} /></label>
              <button className="btn tiny" onClick={()=> setFindingFilters({ severity:'', target:'' })}>Reset</button>
            </div>
            {(debouncedFind.severity || debouncedFind.target) && <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:10}}>
              {debouncedFind.severity && <span style={{fontSize:10, background:'rgba(255,255,255,0.08)', padding:'2px 6px', borderRadius:12}}>severity: {debouncedFind.severity}</span>}
              {debouncedFind.target && <span style={{fontSize:10, background:'rgba(255,255,255,0.08)', padding:'2px 6px', borderRadius:12}}>target: {debouncedFind.target}</span>}
            </div>}
          </Section>
          <Section title="Severity Distribution" defaultOpen={true}>
            {!findings && <div className="skeleton-line" style={{width:'40%'}} />}
            {findings && Object.keys(findings.severityCounts||{}).length===0 && <div style={{fontSize:12, opacity:.5}}>No findings.</div>}
            {findings && Object.keys(findings.severityCounts||{}).length>0 && <table className="mini-table"><thead><tr><th>Severity</th><th>Count</th></tr></thead><tbody>{Object.entries(findings.severityCounts).sort((a,b)=> b[1]-a[1]).map(([sev,c])=> <tr key={sev}><td>{sev}</td><td>{c}</td></tr>)}</tbody></table>}
          </Section>
          <Section title="Recent Findings" defaultOpen={true}>
            {loadingFindings && <div className="skeleton-line" style={{width:'55%'}} />}
            {!loadingFindings && findings && findings.findings?.length===0 && <div style={{fontSize:12, opacity:.5}}>No findings.</div>}
            {!loadingFindings && findings && findings.findings?.length>0 && <FindingsList data={findings.findings} search={globalSearch} />}
          </Section>
        </div>}
  </div>
    </div>
  );
}
