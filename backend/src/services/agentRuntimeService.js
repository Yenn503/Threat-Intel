// Agent runtime helpers: enrichment hooks invoked during scan lifecycle
import { reconAgent } from '../agents/reconAgent.js';
import { vulnAgent } from '../agents/vulnAgent.js';
import { validationAgent } from '../agents/validationAgent.js';
import { reportingAgent } from '../agents/reportingAgent.js';
import { db } from '../db.js';

const agents = [reconAgent, vulnAgent, validationAgent, reportingAgent];

export function enrichScanSummary(scan, summary){
  let enriched = summary || {};
  for(const a of agents){
    try {
      if(typeof a.enrichScanSummary === 'function'){
        enriched = a.enrichScanSummary(scan, enriched, { db }) || enriched;
      }
    } catch {/* ignore enrichment errors */}
  }
  return enriched;
}

export function getReportingAgent(){ return reportingAgent; }

export default { enrichScanSummary, getReportingAgent };
