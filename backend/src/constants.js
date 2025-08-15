// Shared constants & regex
export const TARGET_REGEX = /^[A-Za-z0-9_.:-]{1,253}$/;
export const MAX_SCAN_MS = parseInt(process.env.MAX_SCAN_MS || '600000', 10); // 10 minutes default
export const MAX_OUTPUT_BYTES = parseInt(process.env.MAX_OUTPUT_BYTES || '800000', 10); // cap raw output kept in memory
// Optional target allowlist: comma-separated domains/hosts or wildcard suffixes (*.example.com)
// If defined, targets must match at least one entry; plain entry matches exactly, '*.example.com' matches any subdomain.
export const TARGET_ALLOWLIST = (process.env.TARGET_ALLOWLIST||'').split(/[,\s]+/).filter(Boolean);
export function targetAllowed(host){
	if(!TARGET_ALLOWLIST.length) return true;
	return TARGET_ALLOWLIST.some(rule=> {
		if(rule==='*') return true;
		if(rule.startsWith('*.')){
			const suffix = rule.slice(1); // '.example.com'
			return host.endsWith(suffix) && host.length>suffix.length; // ensure something before suffix
		}
		return host===rule;
	});
}
