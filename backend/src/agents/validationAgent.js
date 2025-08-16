export const validationAgent = {
  id: 'validate',
  description: 'Validation of findings',
  owns: step => ['validate_finding'].includes(step.tool||step.action),
  concurrency: 1,
  enrichScanSummary(scan, summary, { db }){
    if(!summary) return summary;
    // Attach aggregate validation stats (across target) for nuclei scans
    if(scan.type==='nuclei'){
      try {
        const rows = db.prepare(`SELECT vr.validated, COUNT(*) as c FROM validation_results vr JOIN scans s ON s.id=vr.scan_id WHERE s.target=? GROUP BY vr.validated`).all(scan.target);
        const stats = { total:0, validated:0, invalid:0 };
        for(const r of rows){ stats.total += r.c; if(r.validated) stats.validated = r.c; else stats.invalid = r.c; }
        return { ...summary, validation: stats };
      } catch { return summary; }
    }
    return summary;
  }
  // Placeholder for potential future enrichment (e.g., add validation stats)
};
export default validationAgent;
