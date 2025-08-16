export const reportingAgent = {
  id: 'report',
  description: 'Reporting & summarization',
  owns: step => ['summarize_target','summarize','report_findings'].includes(step.tool||step.action),
  concurrency: 1,
  // Provide a helper for report aggregation (consumed by report_findings tool)
  buildAggregate({ target, nmapSummary, nucleiSummary }){
    const findings = (nucleiSummary.findings||[]);
    const severityCounts = findings.reduce((acc,f)=>{ const s=(f.severity||'unknown').toLowerCase(); acc[s]=(acc[s]||0)+1; return acc; },{});
    return {
      target,
      openPorts: nmapSummary.openPorts||[],
      openPortCount: (nmapSummary.openPorts||[]).length||0,
      findings,
      findingCount: findings.length,
      severityCounts,
      generatedAt: new Date().toISOString()
    };
  }
};
export default reportingAgent;
