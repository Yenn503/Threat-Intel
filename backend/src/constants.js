// Shared constants & regex
export const TARGET_REGEX = /^[A-Za-z0-9_.:-]{1,253}$/;
export const MAX_SCAN_MS = parseInt(process.env.MAX_SCAN_MS || '600000', 10); // 10 minutes default
export const MAX_OUTPUT_BYTES = parseInt(process.env.MAX_OUTPUT_BYTES || '800000', 10); // cap raw output kept in memory
// Optional target allowlist: comma-separated domains/hosts or wildcard suffixes (*.example.com)
// Parsed dynamically each call so tests that modify process.env mid-run take effect without process restart.
export function getTargetAllowlist(){
	return (process.env.TARGET_ALLOWLIST||'').split(/[\s,]+/).filter(Boolean);
}
export function targetAllowed(host){
	const list = getTargetAllowlist();
	if(!list.length) return true;
	return list.some(rule=> {
		if(rule==='*') return true;
		if(rule.startsWith('*.')){
			const suffix = rule.slice(1); // '.example.com'
			return host.endsWith(suffix) && host.length>suffix.length; // ensure something before suffix
		}
		return host===rule;
	});
}

// Rate limiting helpers used by builtinTools (restored to match last working push)
export function getTargetRateWindowMs(){
	return parseInt(process.env.TARGET_RATE_WINDOW_MS || '600000', 10); // 10 min default
}
export function getTargetRateMaxForTarget(target){
	// Per-target override map: { "host": number }
	// Parsed fresh each call so tests mutating process.env see immediate effect.
	if(target){
		try {
			const map = JSON.parse(process.env.TARGET_RATE_LIMITS||'{}');
			const val = map?.[target];
			if(Number.isFinite(val) && val>0) return parseInt(val,10);
		} catch {}
	}
	// Fallback env names (support both historical & current)
	const raw = process.env.TARGET_RATE_MAX_PER_TARGET || process.env.TARGET_RATE_MAX || '5';
	const parsed = parseInt(raw,10);
	return Number.isFinite(parsed) && parsed>0 ? parsed : 5;
}
