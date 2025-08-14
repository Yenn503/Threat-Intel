import React, { useState, useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

export default function CodeEditor({ theme }){
  const defaultFiles = [ { id:'scratch.js', name:'scratch.js', language:'javascript', value:`// Scratch pad\nfunction hello(){\n  console.log('Threat-Intel');\n}\nhello();` } ];
  const stored = (()=>{ try { const parsed = JSON.parse(localStorage.getItem('ti_editor_files')); return Array.isArray(parsed) && parsed.length ? parsed : defaultFiles; } catch { return defaultFiles; } })();
  const storedActive = (()=>{ try { return localStorage.getItem('ti_editor_active') || stored[0].id; } catch { return stored[0].id; } })();
  const [files,setFiles] = useState(stored);
  const [activeId,setActiveId] = useState(storedActive);
  const [runOutput,setRunOutput] = useState('');
  const [wrap,setWrap] = useState(false);
  const [minimap,setMinimap] = useState(false);
  const [fontSize,setFontSize] = useState(14);
  const [cursor,setCursor] = useState({ line:1, col:1 });
  const [showSnippets,setShowSnippets] = useState(false);
  const [snapshots,setSnapshots] = useState(()=>{ try { return JSON.parse(localStorage.getItem('ti_editor_snaps'))||{}; } catch { return {}; } });
  const [diffWith,setDiffWith] = useState(null);
  const editorDivRef = useRef(null); const editorRef = useRef(null); const modelMapRef = useRef({}); const disposablesRef = useRef([]); const [initError,setInitError] = useState(null); const reinitCounterRef = useRef(0);
  useEffect(()=>{ if(!files.length){ setFiles(defaultFiles); setActiveId(defaultFiles[0].id); } },[files]);
  const activeFile = files.find(f=>f.id===activeId) || files[0] || defaultFiles[0];
  useEffect(()=>{ localStorage.setItem('ti_editor_files', JSON.stringify(files)); },[files]);
  useEffect(()=>{ localStorage.setItem('ti_editor_active', activeId); },[activeId]);
  useEffect(()=>{ localStorage.setItem('ti_editor_snaps', JSON.stringify(snapshots)); },[snapshots]);
  useEffect(()=>{ if(!editorDivRef.current || editorRef.current) return; try { if(!monaco?.editor) throw new Error('Monaco not loaded'); editorRef.current = monaco.editor.create(editorDivRef.current, { value: activeFile?.value || '', language: activeFile?.language || 'javascript', theme: theme==='light'? 'vs' : 'vs-dark', automaticLayout: true, fontSize, minimap: { enabled: minimap }, wordWrap: wrap? 'on':'off', smoothScrolling: true, scrollBeyondLastLine: false, renderWhitespace: 'selection' }); const ed = editorRef.current; disposablesRef.current.push(ed.onDidChangeCursorPosition(e=> setCursor({ line:e.position.lineNumber, col:e.position.column }))); disposablesRef.current.push(ed.onDidChangeModelContent(()=>{ const val = ed.getValue(); setFiles(fs => fs.map(f => f.id===activeId ? { ...f, value: val } : f)); try { const model = ed.getModel(); if(model){ const text = model.getValue(); const markers = []; text.split(/\n/).forEach((ln,i)=>{ if(/TODO/i.test(ln)){ markers.push({ startLineNumber:i+1,endLineNumber:i+1,startColumn:1,endColumn:ln.length+1,message:'TODO found',severity: monaco.MarkerSeverity.Info }); } }); monaco.editor.setModelMarkers(model,'ti',markers); } } catch {} })); ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, ()=> saveActive()); ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, ()=> runCode()); ed.addCommand(monaco.KeyCode.F5, ()=> runCode()); ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, ()=> saveActive()); setInitError(null);} catch(e){ console.error(e); setInitError(e.message||'Editor failed to load'); } return ()=> { disposablesRef.current.forEach(d=> d.dispose && d.dispose()); editorRef.current?.dispose(); }; },[reinitCounterRef.current]);
  function forceReinit(){ try { disposablesRef.current.forEach(d=> d.dispose && d.dispose()); } catch {} try { editorRef.current?.dispose(); } catch {} editorRef.current = null; setInitError(null); reinitCounterRef.current += 1; }
  useEffect(()=>{ if(editorRef.current){ monaco.editor.setTheme(theme==='light'? 'vs':'vs-dark'); } },[theme]);
  useEffect(()=>{ if(editorRef.current){ editorRef.current.updateOptions({ wordWrap: wrap? 'on':'off' }); } },[wrap]);
  useEffect(()=>{ if(editorRef.current){ editorRef.current.updateOptions({ minimap: { enabled: minimap } }); } },[minimap]);
  useEffect(()=>{ if(editorRef.current){ editorRef.current.updateOptions({ fontSize }); } },[fontSize]);
  useEffect(()=>{ if(!editorRef.current || !activeFile) return; const key = activeFile.id; let model = modelMapRef.current[key]; if(!model){ model = monaco.editor.createModel(activeFile.value, activeFile.language); modelMapRef.current[key] = model; } editorRef.current.setModel(model); },[activeId]);
  function saveActive(){ setRunOutput(o=>`// Saved ${activeFile.name} at ${new Date().toLocaleTimeString()}`); if(!activeFile) return; const snap = { id: Date.now(), code: activeFile.value || '', ts: Date.now() }; setSnapshots(s => { const arr = [...(s[activeFile.id]||[]), snap].slice(-10); return { ...s, [activeFile.id]: arr }; }); }
  function addFile(){ const base = 'file'; let i=1; while(files.some(f=>f.name===`${base}${i}.js`)) i++; const nf = { id:`${base}${i}.js`, name:`${base}${i}.js`, language:'javascript', value:'// new file\n' }; setFiles(f=>[...f,nf]); setActiveId(nf.id); }
  function closeFile(id){ if(files.length===1) return; const idx = files.findIndex(f=>f.id===id); const newFiles = files.filter(f=>f.id!==id); setFiles(newFiles); if(activeId===id){ const next = newFiles[idx-1] || newFiles[0]; setActiveId(next.id); } }
  function renameFile(id){ const name = prompt('Rename file', files.find(f=>f.id===id)?.name || ''); if(!name) return; if(files.some(f=>f.name===name && f.id!==id)) return alert('Name already exists'); setFiles(fs=> fs.map(f=> f.id===id? { ...f, id:name, name } : f)); if(activeId===id) setActiveId(name); }
  function changeLanguage(lang){ setFiles(fs=> fs.map(f=> f.id===activeId? { ...f, language:lang } : f)); const model = editorRef.current?.getModel(); if(model){ monaco.editor.setModelLanguage(model, lang); } }
  function formatDoc(){ editorRef.current?.getAction('editor.action.formatDocument')?.run(); }
  function runCode(){ if(activeFile.language!=='javascript' && activeFile.language!=='typescript'){ setRunOutput('// Run supported only for JavaScript/TypeScript'); return; } const code = editorRef.current?.getValue() || ''; const logs = []; const original = { log:console.log, error:console.error, warn:console.warn }; try { console.log = (...a)=>{ logs.push(a.join(' ')); }; console.error = (...a)=>{ logs.push('[error] '+a.join(' ')); }; console.warn = (...a)=>{ logs.push('[warn] '+a.join(' ')); }; const fn = new Function(code); const res = fn(); if(res !== undefined) logs.push('[return] '+JSON.stringify(res)); setRunOutput(logs.join('\n')); } catch(e){ setRunOutput(String(e)); } finally { console.log = original.log; console.error = original.error; console.warn = original.warn; } }
  const snippets = [ { name:'HTTP fetch', code:`async function grab(url){\n  const res = await fetch(url);\n  const txt = await res.text();\n  console.log('len', txt.length);\n}\n`}, { name:'Exploit template', code:`/** Basic exploit POC template */\nasync function exploit(target){\n  // TODO: craft request\n  console.log('Target =>', target);\n}\n`}, { name:'Bruteforce loop', code:`for(let i=0;i<10;i++){\n  console.log('Attempt', i);\n}\n`} ];
  function insertSnippet(sn){ const ed = editorRef.current; if(!ed) return; ed.executeEdits('insert-snippet',[{ range: ed.getSelection(), text: sn.code, forceMoveMarkers:true }]); setShowSnippets(false); }
  const snapList = snapshots[activeFile.id]||[]; function openDiff(snap){ setDiffWith(snap); } function closeDiff(){ setDiffWith(null); }
  function computeDiff(a,b){ const aLines = a.split('\n'); const bLines = b.split('\n'); const max = Math.max(aLines.length,bLines.length); const rows=[]; for(let i=0;i<max;i++){ const oldL=aLines[i]??''; const newL=bLines[i]??''; if(oldL===newL) rows.push({t:'ctx', old:oldL}); else { if(oldL) rows.push({t:'del', old:oldL}); if(newL) rows.push({t:'add', new:newL}); } } return rows; }
  const diffRows = diffWith? computeDiff(diffWith.code, activeFile.value||'') : [];
  function downloadActive(){ if(!activeFile) return; const blob = new Blob([activeFile.value || ''], { type:'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = activeFile.name; a.click(); setRunOutput(o=>`// Downloaded ${activeFile.name}`); }
  return <div className="card" style={{padding:0, display:'flex', flexDirection:'column', height:'calc(100vh - 170px)', position:'relative'}}>
    <div className="editor-tabs"><div className="tabs-scroll">{files.map(f=> <div key={f.id} className={"editor-tab "+(f.id===activeId?'active':'')} onClick={()=> setActiveId(f.id)}><span onDoubleClick={()=> renameFile(f.id)}>{f.name}</span><button className="tab-close" onClick={(e)=>{ e.stopPropagation(); closeFile(f.id); }} title="Close">×</button></div>)}<button className="tab-add" onClick={addFile} title="New file">+</button></div><div className="editor-toolbar"><select value={activeFile?.language || 'javascript'} onChange={e=> changeLanguage(e.target.value)}><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="json">JSON</option><option value="python">Python</option><option value="shell">Shell</option><option value="markdown">Markdown</option></select><button onClick={saveActive}>Save</button><button onClick={formatDoc}>Format</button><button onClick={runCode}>Run</button><button onClick={()=> setWrap(w=>!w)} className={wrap?'on':''} title="Toggle wrap">Wrap</button><button onClick={()=> setMinimap(m=>!m)} className={minimap?'on':''} title="Toggle minimap">Map</button><button onClick={()=> setFontSize(s=> Math.min(24,s+1))}>A+</button><button onClick={()=> setFontSize(s=> Math.max(10,s-1))}>A-</button><button onClick={()=> setShowSnippets(s=>!s)} className={showSnippets?'on':''}>Snippets</button><button onClick={downloadActive} title="Download file">DL</button><button onClick={()=> openDiff(snapList[snapList.length-1])} disabled={!snapList.length}>Diff</button></div></div>
    {showSnippets && <div className="snippet-pop">{snippets.map(sn=> <div key={sn.name} className="snippet-item" onClick={()=> insertSnippet(sn)}>{sn.name}</div>)}</div>}
    {snapList.length>0 && <div className="snapshots-bar"><div className="snapshots-title">Snaps:</div>{snapList.map(s=> <button key={s.id} className="snap-btn" onClick={()=> openDiff(s)} title={new Date(s.ts).toLocaleTimeString()}>{new Date(s.ts).toLocaleTimeString()}</button>)}</div>}
    {initError ? <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12}}><div style={{fontSize:'.75rem', color:'var(--danger)'}}>Editor failed: {initError}</div><button className="btn" onClick={forceReinit}>Retry Load</button></div> : <div ref={editorDivRef} style={{flex:1, minHeight:0}} />}
    <div className="editor-status"><div>L{cursor.line}:C{cursor.col}</div><div style={{flex:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis'}}>{activeFile?.name||''}</div><div style={{opacity:.75}}>Font {fontSize}px</div></div>
    <div className="run-output"><div className="run-output-title">OUTPUT</div><pre>{runOutput}</pre></div>
    {diffWith && <DiffModal snap={diffWith} current={activeFile} rows={diffRows} close={closeDiff} />}
  </div>;
}

function DiffModal({ snap, current, rows, close }){
  return (
    <div className="diff-modal" role="dialog" aria-modal="true">
      <div className="diff-card">
        <div className="diff-head">
          Diff: {current.name}
          <span style={{marginLeft:8,fontSize:'.6rem',fontWeight:400}}> vs {new Date(snap.ts).toLocaleTimeString()}</span>
          <button className="diff-close" onClick={close}>×</button>
        </div>
        <div className="diff-body">
          {rows.map((r,i)=> (
            <div key={i} className={'diff-line '+r.t}>
              <div className="gutter">{r.t==='add'?'+':r.t==='del'?'-':' '}</div>
              <pre>{r.old || r.new || ''}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
