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
