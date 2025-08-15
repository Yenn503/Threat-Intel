// Prevent accidental non-deterministic agent mode in CI
if(process.env.CI){
  if(process.env.AGENT_NON_DETERMINISTIC === '1'){
    console.error('[CI GUARD] AGENT_NON_DETERMINISTIC=1 detected – deterministic tests required in CI.');
    process.exit(2);
  }
}
// Also enforce fast fake scan delay upper bound (to avoid slow PRs)
const delay = parseInt(process.env.SCAN_FAKE_DELAY_MS||'5',10);
if(delay > 50){
  console.error(`[CI GUARD] SCAN_FAKE_DELAY_MS=${delay} too high for CI (max 50).`);
  process.exit(3);
}
