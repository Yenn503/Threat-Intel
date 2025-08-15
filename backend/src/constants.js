// Shared constants & regex
export const TARGET_REGEX = /^[A-Za-z0-9_.:-]{1,253}$/;
export const MAX_SCAN_MS = parseInt(process.env.MAX_SCAN_MS || '600000', 10); // 10 minutes default
export const MAX_OUTPUT_BYTES = parseInt(process.env.MAX_OUTPUT_BYTES || '800000', 10); // cap raw output kept in memory
