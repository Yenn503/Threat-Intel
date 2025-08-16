export const vulnAgent = {
  id: 'vuln',
  description: 'Vulnerability scanning (nuclei)',
  owns: step => ['nuclei_scan'].includes(step.tool||step.action),
  concurrency: 2,
  enrichScanSummary(scan, summary, { db }){
    if(scan.type !== 'nuclei' || !summary || !Array.isArray(summary.findings)) return summary;
    // Correlate findings to service tags from latest nmap
    try {
      const lastNmap = db.prepare("SELECT summary_json FROM scans WHERE target=? AND type='nmap' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(scan.target);
      let nmapSummary={}; try { nmapSummary = JSON.parse(lastNmap?.summary_json||'{}'); } catch{}
      const serviceTags = (nmapSummary.serviceTags||[]).map(s=> String(s).toLowerCase());
      const correlation = {}; const correlatedServices = new Set();
      for(const f of summary.findings){
        const text = (f.id+' '+(f.summary||'')).toLowerCase();
        for(const tag of serviceTags){ if(text.includes(tag)){ (correlation[tag] ||= []).push(f.id); correlatedServices.add(tag); } }
      }
      const severityCounts = summary.findings.reduce((acc,f)=>{ const s=(f.severity||'unknown').toLowerCase(); acc[s]=(acc[s]||0)+1; return acc; },{});
      return { ...summary, vuln: { correlatedServices: Array.from(correlatedServices).sort(), serviceCorrelation: correlation, severityCounts } };
    } catch { return summary; }
  }
};
export default vulnAgent;
