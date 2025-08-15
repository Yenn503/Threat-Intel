// Utilities to safely merge allowlist hosts & per-target rate limits across test files
export function addAllowlistHosts(hosts){
  const existing = (process.env.TARGET_ALLOWLIST||'').split(/[\,\s]+/).filter(Boolean);
  const cleaned = hosts.filter(Boolean).filter(h=> h!=='*'); // avoid re‑introducing global wildcard
  const union = [...new Set([...(existing), ...cleaned])];
  process.env.TARGET_ALLOWLIST = union.join(',');
  return process.env.TARGET_ALLOWLIST;
}

// Standard hosts used across most agent/scanning tests – centralize to reduce duplication
const STANDARD_TEST_HOSTS = [
  'scanme.nmap.org',
  'toolflow.test',
  'ratelimit1.test',
  'ratelimit2.test',
  'validate.test'
];

export function addStandardTestHosts(extra=[]) {
  return addAllowlistHosts([...STANDARD_TEST_HOSTS, ...extra]);
}

export function mergeTargetRateLimits(map){
  if(!map || typeof map !== 'object') return process.env.TARGET_RATE_LIMITS;
  let current={};
  try { current = JSON.parse(process.env.TARGET_RATE_LIMITS||'{}'); } catch { current={}; }
  const merged = { ...current, ...map };
  process.env.TARGET_RATE_LIMITS = JSON.stringify(merged);
  return process.env.TARGET_RATE_LIMITS;
}

export function ensureHighDefaultLimits(){
  if(!process.env.TARGET_RATE_MAX) process.env.TARGET_RATE_MAX='50';
  if(!process.env.TARGET_RATE_WINDOW_MS) process.env.TARGET_RATE_WINDOW_MS='600000';
}

// Create a fresh in-memory DB for an individual test file (Phase 1 isolation)
export async function isolateDb(label){
  const mod = await import('../db.js');
  mod.isolateTestDb(label||'');
  // Reseed admin
  const bcryptMod = await import('bcryptjs');
  mod.seedAdmin(bcryptMod.default || bcryptMod);
  return mod.db;
}

export default { addAllowlistHosts, addStandardTestHosts, mergeTargetRateLimits, ensureHighDefaultLimits, isolateDb };
