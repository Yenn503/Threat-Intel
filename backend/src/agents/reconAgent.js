// Recon Agent: adds contextual enrichment to nmap outputs
export const reconAgent = {
  id: 'recon',
  description: 'Discovery & enumeration (nmap, dns lookup)',
  owns: step => ['nmap_scan','dns_lookup','queue-scan','await-scan'].includes(step.tool||step.action),
  concurrency: 3,
  enrichScanSummary(scan, summary){
    if(scan.type !== 'nmap' || !summary || !Array.isArray(summary.openPorts)) return summary;
    const services = summary.openPorts.map(p=> (p.service||'').toLowerCase());
    const categories = new Set();
    const addIf = (cond, cat)=> { if(cond) categories.add(cat); };
    addIf(services.some(s=> /http|https|nginx|apache|tomcat/.test(s)), 'web');
    addIf(services.some(s=> /mysql|postgres|redis|mssql/.test(s)), 'database');
    addIf(services.some(s=> /ssh|rdp|ftp/.test(s)), 'remote_access');
    addIf(services.some(s=> /smtp|imap|pop3/.test(s)), 'mail');
    const nextSteps = [];
    if(services.some(s=> /http|https|nginx|apache|tomcat/.test(s))) nextSteps.push('Run nuclei_scan (web templates) if not recently executed.');
    if(services.includes('ssh')) nextSteps.push('Review SSH hardening: key auth only, disable root login.');
    if(services.includes('redis')) nextSteps.push('Verify Redis is not exposed publicly and requires auth.');
    const riskHints = [];
    for(const p of summary.openPorts){
      if(p.port===22) riskHints.push('SSH exposed (22) – ensure strong auth & patching.');
      if(p.port===3389) riskHints.push('RDP (3389) exposed – evaluate necessity / restrict.');
      if(p.port===445) riskHints.push('SMB (445) exposed – check for legacy protocols & patch level.');
      if(p.port===3306) riskHints.push('MySQL (3306) exposed – restrict to internal / enforce TLS.');
      if(p.port===6379) riskHints.push('Redis (6379) exposed – risk of unauth access.');
      if(p.port===80 || p.port===443) riskHints.push('Web service detected – assess attack surface (directories, frameworks).');
    }
    return { ...summary, recon: { categories: Array.from(categories).sort(), recommendedNextSteps: nextSteps, riskHints } };
  }
};
export default reconAgent;
