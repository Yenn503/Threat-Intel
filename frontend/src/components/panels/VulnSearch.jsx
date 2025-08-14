import React, { useState } from 'react';

export default function VulnSearch({ token, active }){
  if(active === false) return <div style={{display:'none'}} aria-hidden="true" />;
  const [keyword, setKeyword] = useState('');
  const [rawResults, setRawResults] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function search(){
    if(!keyword) return;
    setLoading(true); setRawResults(null); setError('');
    try {
      const r = await fetch('http://localhost:4000/api/cve?keyword='+encodeURIComponent(keyword), { headers: { Authorization: 'Bearer '+token }});
      const data = await r.json();
      if(!r.ok){ throw new Error(data.error || 'Search failed'); }
      setRawResults(data);
    } catch(e){ setError(e.message); }
    finally { setLoading(false); }
  }
  // Normalize to an array
  const list = Array.isArray(rawResults) ? rawResults :
    Array.isArray(rawResults?.vulnerabilities) ? rawResults.vulnerabilities :
    Array.isArray(rawResults?.vulnMatch) ? rawResults.vulnMatch : [];
  return <div className="card">
    <h3 style={{marginTop:0}}>CVE Search</h3>
    <div style={{display:'flex', gap:10, marginBottom:14}}>
      <input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="e.g., OpenSSL" />
      <button className="btn accent" onClick={search} disabled={loading}>{loading?'...':'Search'}</button>
    </div>
    {error && <div style={{color:'var(--danger)', fontSize:'.65rem', marginBottom:10}}>{error}</div>}
    {loading && <div style={{fontSize:'.65rem', color:'var(--text-dim)'}}>Searching...</div>}
    {!loading && !error && list.length===0 && rawResults && <div style={{fontSize:'.65rem', color:'var(--text-dim)'}}>No results.</div>}
    {list.length>0 && <div className="table-scroll"><table>
      <thead><tr><th>CVE</th><th>Published</th><th>Score</th><th>Description</th></tr></thead>
      <tbody>
        {list.slice(0,50).map(v => {
          const id = v.cve?.id || v.id || v.cve?.CVE_data_meta?.ID || v.id || 'Unknown';
            const desc = v.cve?.descriptions?.[0]?.value || v.descriptions?.[0]?.value || v.description || '';
            const metrics = v.metrics || {};
            const score = metrics.cvssMetricV31?.[0]?.cvssData?.baseScore || metrics.cvssMetricV2?.[0]?.cvssData?.baseScore || '';
            return <tr key={id}><td>{id}</td><td>{v.published || v.publishedDate || ''}</td><td>{score}</td><td style={{maxWidth:420, whiteSpace:'normal'}}>{desc}</td></tr>;
        })}
      </tbody>
    </table></div>}
  </div>;
}
