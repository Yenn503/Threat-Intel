import { request } from './http';

export const getBinaries = token =>
  request('/api/scan/binaries', { token });

export const listRecentScans = token =>
  request('/api/ai/report/recent-scans', { token }); // placeholder if endpoint exists
