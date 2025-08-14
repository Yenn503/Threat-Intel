import React, { useState } from 'react';

// Restored original FSWA panel with WHOIS, Shodan, and WordPress plugin detection
export default function FSWA({ token, active }) {
  if(active === false) return <div style={{display:'none'}} aria-hidden="true" />;
  // Tabs: whois | shodan | plugins
  const [tab,setTab] = useState('whois');
  // WHOIS
  const [target,setTarget] = useState('example.com');
  const [whoisData,setWhoisData] = useState(null);
  const [whoisLoading,setWhoisLoading] = useState(false);
  const [whoisError,setWhoisError] = useState('');
  const [showWhoisRaw,setShowWhoisRaw] = useState(false);
  // Shodan
  const [ip,setIp] = useState('1.1.1.1');
  const [domain,setDomain] = useState('example.com');
  const [shodanData,setShodanData] = useState(null);
  const [shodanLoading,setShodanLoading] = useState(false);
  const [shodanError,setShodanError] = useState('');
  // WP Plugins
  const [wpTarget,setWpTarget] = useState('example.com');
  const [wpDeep,setWpDeep] = useState(false);
  const [wpExtra,setWpExtra] = useState('');
  const [wpData,setWpData] = useState(null);
  const [wpLoading,setWpLoading] = useState(false);
  const [wpError,setWpError] = useState('');
  const [wpExpand,setWpExpand] = useState(null); // slug for which evidence open

  async function runWhois(){
    if(!target.trim()) return;
    const norm = target.replace(/^https?:\/\//i,'').split(/[\/#!?]/)[0];
    setWhoisLoading(true); setWhoisError(''); setWhoisData(null);
    try {
      const r = await fetch('http://localhost:4000/api/assess/whois?target='+encodeURIComponent(norm), { headers:{ Authorization:'Bearer '+token }});
      const data = await r.json(); if(!r.ok) throw new Error(data.error||'whois failed'); setWhoisData(data.data);
    } catch(e){ setWhoisError(e.message); }
    finally { setWhoisLoading(false); }
  }
  async function runShodan(){
    if(!ip.trim() && !domain.trim()) return;
    setShodanLoading(true); setShodanError(''); setShodanData(null);
    try {
      let url;
      if(domain && !ip){ url = 'http://localhost:4000/api/assess/shodan?domain='+encodeURIComponent(domain); }
      else { url = 'http://localhost:4000/api/assess/shodan?ip='+encodeURIComponent(ip); }
      const r = await fetch(url, { headers:{ Authorization:'Bearer '+token }});
      const data = await r.json(); if(!r.ok) throw new Error(data.error||'shodan failed'); setShodanData(data);
    } catch(e){ setShodanError(e.message); }
    finally { setShodanLoading(false); }
  }
  async function runWpPlugins(){
    if(!wpTarget.trim()) return;
    const norm = wpTarget.replace(/^https?:\/\//i,'').split(/[\/#!?]/)[0];
    setWpLoading(true); setWpError(''); setWpData(null); setWpExpand(null);
    try {
      let url = 'http://localhost:4000/api/assess/wpplugins?target='+encodeURIComponent(norm)+(wpDeep?'&deep=1':'');
      if(wpExtra.trim()) url += '&extra='+encodeURIComponent(wpExtra.trim());
      const r = await fetch(url, { headers:{ Authorization:'Bearer '+token }});
      const data = await r.json(); if(!r.ok) throw new Error(data.error||'scan failed'); setWpData(data);
    } catch(e){ setWpError(e.message); }
    finally { setWpLoading(false); }
  }
  function pretty(obj){ try { return JSON.stringify(obj,null,2); } catch { return String(obj); } }
  return <div className="card" style={{minHeight:'calc(100vh - 170px)', width:'100%', display:'flex', flexDirection:'column', fontSize:'.9rem', padding:'26px 30px'}}>
    <h3 style={{marginTop:0, fontSize:'1.1rem'}}>First Stage Web Application Assessment</h3>
    <p style={{margin:'4px 0 14px', fontSize:'.72rem', color:'var(--text-dim)', lineHeight:1.4}}>Recon helpers. Tabs: WHOIS, Shodan host banners, WordPress plugin heuristic detection.</p>
    <div style={{display:'flex', gap:8, marginBottom:14}}>
      {['whois','shodan','plugins'].map(t=> <button key={t} className={'btn '+(tab===t?'accent':'')} style={{padding:'6px 12px', fontSize:'.6rem'}} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>)}
    </div>
    {tab==='whois' && <div style={{display:'flex', gap:24, flexWrap:'wrap'}}>
      <div style={{flex:'1 1 520px', minWidth:360, display:'flex', flexDirection:'column', gap:10}}>
        <div className="section-label" style={{fontSize:'.7rem'}}>WHOIS Lookup</div>
        <div style={{display:'flex', gap:8}}>
          <input value={target} onChange={e=>setTarget(e.target.value)} placeholder="domain or ip" />
          <button className="btn accent" onClick={runWhois} disabled={whoisLoading}>{whoisLoading?'...':'Run'}</button>
        </div>
        {whoisError && <div className="form-error" style={{marginTop:4}}>{whoisError}</div>}
        {whoisData && <div style={{display:'flex', flexDirection:'column', gap:10}}>
          {whoisData.summary && <div className="card" style={{padding:'12px 14px'}}>
            <div style={{fontSize:'.7rem', letterSpacing:'.5px', color:'var(--text-dim)', marginBottom:6}}>SUMMARY</div>
            <div style={{display:'grid', gridTemplateColumns:'140px 1fr', gap:'6px 14px', fontSize:'.7rem', lineHeight:1.3}}>
              {Object.entries(whoisData.summary).filter(([k,v])=> v && k!=='nameServers' && k!=='status').map(([k,v])=> <React.Fragment key={k}><div style={{textTransform:'capitalize', opacity:.65}}>{k}</div><div>{String(v)}</div></React.Fragment>)}
              {Array.isArray(whoisData.summary.nameServers) && <><div>NS</div><div>{whoisData.summary.nameServers.join(', ')}</div></>}
              {Array.isArray(whoisData.summary.status) && <><div>Status</div><div>{whoisData.summary.status.join(', ')}</div></>}
            </div>
          </div>}
          {whoisData.errorMessage && <div className="card danger" style={{padding:'12px 14px', background:'linear-gradient(var(--danger-bg), var(--danger-bg2))'}}>
            <div style={{fontSize:'.7rem', fontWeight:600, marginBottom:6}}>WHOIS ERROR</div>
            <div style={{fontSize:'.7rem', whiteSpace:'pre-wrap', lineHeight:1.4}}>{whoisData.errorMessage}</div>
          </div>}
          <div className="card" style={{padding:'12px 14px'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div style={{fontSize:'.7rem', letterSpacing:'.5px', color:'var(--text-dim)'}}>FIELDS ({Object.keys(whoisData.parsed?.fields||{}).length})</div>
              <button className="btn" style={{padding:'6px 10px', fontSize:'.6rem'}} onClick={()=>setShowWhoisRaw(s=>!s)}>{showWhoisRaw? 'Hide Raw':'Show Raw'}</button>
            </div>
            <div className="table-scroll" style={{maxHeight:220, marginTop:8, fontSize:'.67rem'}}>
              <table><thead><tr><th style={{width:160}}>Key</th><th>Value</th></tr></thead><tbody>
                {Object.entries(whoisData.parsed?.fields||{}).slice(0,240).map(([k,v])=> <tr key={k}><td style={{fontWeight:600}}>{k}</td><td style={{whiteSpace:'pre-wrap', lineHeight:1.3}}>{Array.isArray(v)? v.join(', '): String(v)}</td></tr>)}
              </tbody></table>
            </div>
            {showWhoisRaw && <pre style={{marginTop:10, fontSize:'.6rem', maxHeight:200, overflow:'auto', lineHeight:1.35}}>{whoisData.raw}</pre>}
            {whoisData.disclaimer && !showWhoisRaw && <div style={{marginTop:10, fontSize:'.55rem', opacity:.6, lineHeight:1.35}}>{whoisData.disclaimer.slice(0,600)}{whoisData.disclaimer.length>600?'…':''}</div>}
          </div>
        </div>}
        {!whoisData && !whoisLoading && !whoisError && <div className="card card-glow"><p style={{margin:0, fontSize:'.62rem'}}>Enter a target domain and run WHOIS.</p></div>}
      </div>
    </div>}
    {tab==='shodan' && <div style={{display:'flex', flexDirection:'column', gap:14, maxWidth:780}}>
      <div className="section-label" style={{fontSize:'.7rem'}}>Shodan Host Info</div>
      <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
        <input style={{flex:'1 1 140px'}} value={ip} onChange={e=>setIp(e.target.value)} placeholder="ip (or leave blank)" />
        <input style={{flex:'1 1 140px'}} value={domain} onChange={e=>setDomain(e.target.value)} placeholder="domain (alt)" />
        <button className="btn accent" onClick={runShodan} disabled={shodanLoading}>{shodanLoading?'...':'Run'}</button>
      </div>
      {shodanError && <div className="form-error" style={{marginTop:4}}>{shodanError}</div>}
      {shodanData && <div className="table-scroll" style={{maxHeight:300, fontSize:'.72rem'}}>
        <table><thead><tr><th style={{width:150}}>IP</th><th>Org</th><th>OS</th><th>Ports</th></tr></thead><tbody>
          {(shodanData.hosts||[]).map(h=> <tr key={h.ip}><td style={{fontWeight:600}}>{h.ip}</td><td>{h.data?.org || h.data?.isp || ''}</td><td>{h.data?.os || ''}</td><td style={{whiteSpace:'normal'}}>{Array.isArray(h.data?.ports)? h.data.ports.slice(0,15).join(', '): (h.data?.port || '')}</td></tr>)}
        </tbody></table>
      </div>}
      {shodanData?.hosts && shodanData.hosts[0]?.data?.data && <div className="card" style={{padding:'10px 12px', maxHeight:220, overflow:'auto'}}>
        <div style={{fontSize:'.65rem', letterSpacing:'.5px', color:'var(--text-dim)', marginBottom:6}}>FIRST HOST SAMPLE BANNERS</div>
        <pre style={{margin:0, fontSize:'.6rem', lineHeight:1.35}}>{pretty((shodanData.hosts[0].data.data||[]).slice(0,3))}</pre>
      </div>}
      {!shodanData && !shodanLoading && !shodanError && <div className="card card-glow"><p style={{margin:0, fontSize:'.62rem'}}>Enter IP or domain for Shodan host lookup.</p></div>}
      <div style={{fontSize:'.55rem', color:'var(--text-dim)'}}>Shodan requires server env var SHODAN_KEY. Data truncated.</div>
    </div>}
    {tab==='plugins' && <div style={{display:'flex', flexDirection:'column', gap:14}}>
      <div className="section-label" style={{fontSize:'.7rem'}}>WordPress Plugin Detection (Heuristic)</div>
      <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
        <input style={{flex:'1 1 220px'}} value={wpTarget} onChange={e=>setWpTarget(e.target.value)} placeholder="target domain" />
        <input style={{flex:'1 1 260px'}} value={wpExtra||''} onChange={e=>setWpExtra(e.target.value)} placeholder="extra slugs (comma sep)" />
        <label style={{display:'flex', alignItems:'center', gap:4, fontSize:'.55rem'}}><input type="checkbox" checked={wpDeep} onChange={e=>setWpDeep(e.target.checked)} /> Deep</label>
        <button className="btn accent" onClick={runWpPlugins} disabled={wpLoading}>{wpLoading?'...':'Scan'}</button>
      </div>
      {wpError && <div className="form-error" style={{marginTop:4}}>{wpError}</div>}
      {wpData && !wpData.ok && <div className="card danger" style={{padding:'10px 12px'}}><div style={{fontSize:'.65rem'}}>Fetch failed: {wpData.error||'error'}</div></div>}
      {wpData?.notWordPress && <div className="card" style={{padding:'10px 12px', background:'linear-gradient(var(--bg-alt), var(--bg-alt2))'}}>
        <div style={{fontSize:'.65rem', lineHeight:1.4}}>Site doesn't appear to be WordPress.<br/><span style={{opacity:.7}}>{wpData.reason}</span></div>
      </div>}
      {wpData?.ok && <>
        <div style={{display:'flex', gap:16, flexWrap:'wrap', fontSize:'.6rem', color:'var(--text-dim)'}}>
          <div>Target: <strong style={{color:'var(--text)'}}>{wpData.target}</strong></div>
          <div>HTTP: {wpData.status}</div>
          <div>Plugins: {wpData.plugins.length}</div>
          <div>Mode: {wpDeep? 'deep':'lite'}</div>
          {wpData.cached && <div style={{color:'var(--ok)'}}>Cached</div>}
          <div>Fetched {new Date(wpData.fetchedAt).toLocaleTimeString()}</div>
        </div>
        {wpData.plugins.length===0 && <div className="card card-glow"><p style={{margin:0, fontSize:'.62rem'}}>No plugin paths detected in initial HTML.</p></div>}
        {wpData.plugins.length>0 && <div className="table-scroll" style={{maxHeight:360, fontSize:'.65rem'}}>
          <table><thead><tr><th style={{width:180}}>Plugin</th><th>Version</th><th>Confidence</th><th>REST</th><th>Source</th><th>Evidence</th></tr></thead><tbody>
            {wpData.plugins.map(p=>{
              const open = wpExpand===p.slug;
              return <React.Fragment key={p.slug}>
                <tr className={open?'open':''} onClick={()=> setWpExpand(s=> s===p.slug? null : p.slug)} style={{cursor:'pointer'}}>
                  <td style={{fontWeight:600}}>{p.name || p.slug}{p.originalSlug && p.originalSlug!==p.slug && <span style={{marginLeft:4, opacity:.6, fontWeight:400}}>({p.originalSlug})</span>}{p.readme && <span style={{marginLeft:6, color:'var(--ok)'}}>✓</span>}{p.signature && !p.readme && <span style={{marginLeft:6, color:'#f59e0b'}}>sig</span>}{p.source==='enumerated' && <span style={{marginLeft:6, color:'#3b82f6'}}>enum</span>}</td>
                  <td>{p.version||''}</td>
                  <td>{Math.round((p.confidence||0)*100)}%</td>
                  <td>{p.restStatus==='verified'? <span style={{color:'var(--ok)'}}>✔</span>: p.restStatus==='protected'? <span style={{color:'#f59e0b'}}>!</span>: ''}</td>
                  <td>{p.source|| (p.signature? 'signature':'path')}</td>
                  <td>{(p.evidence||[]).length}</td>
                </tr>
                {open && <tr>
                  <td colSpan={6} style={{background:'var(--bg-alt)'}}>
                    <div style={{display:'flex', flexDirection:'column', gap:6}}>
                      {(p.evidence||[]).slice(0,6).map((sn,i)=><pre key={i} style={{margin:0, fontSize:'.55rem', whiteSpace:'pre-wrap', background:'var(--bg)', padding:'6px 8px', borderRadius:4, lineHeight:1.3}}>{sn}</pre>)}
                      {p.readme && <div style={{fontSize:'.55rem', color:'var(--ok)'}}>readme.txt fetched{p.version? ' • version '+p.version:''}</div>}
                      {p.signature && !p.readme && <div style={{fontSize:'.55rem', color:'#f59e0b'}}>signature pattern only (lower confidence)</div>}
                      {p.restStatus==='verified' && <div style={{fontSize:'.55rem', color:'var(--ok)'}}>REST endpoint responded 200 (strong confirmation)</div>}
                      {p.restStatus==='protected' && <div style={{fontSize:'.55rem', color:'#f59e0b'}}>REST endpoint access blocked (probable existence)</div>}
                      {p.source==='enumerated' && !p.readme && <div style={{fontSize:'.55rem', color:'#3b82f6'}}>enumeration path/protection hint</div>}
                    </div>
                  </td>
                </tr>}
              </React.Fragment>;
            })}
          </tbody></table>
        </div>}
        <div style={{fontSize:'.55rem', color:'var(--text-dim)', marginTop:8}}>Confidence layers: path/signature + readme + REST (✔ strong / ! protected) + version. Click a row to expand evidence.</div>
      </>}
      {!wpData && !wpLoading && !wpError && <div className="card card-glow"><p style={{margin:0, fontSize:'.62rem'}}>Enter a WordPress site domain (no protocol) and run scan.</p></div>}
    </div>}
  </div>;
}
