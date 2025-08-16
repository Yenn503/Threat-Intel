import { request } from './http';

export const getReportSummary = token =>
  request('/api/ai/report/summary', { token });

export const getReportTimeseries = (token, params = {}) => {
  const qs = new URLSearchParams();
  if (params.hours) qs.set('hours', params.hours);
  if (params.types) qs.set('types', params.types);
  if (params.targetContains) qs.set('targetContains', params.targetContains);
  return request('/api/ai/report/timeseries?' + qs.toString(), { token });
};

export const getReportFindings = (token, params = {}) => {
  const qs = new URLSearchParams();
  if (params.severity) qs.set('severity', params.severity);
  if (params.targetContains) qs.set('targetContains', params.targetContains);
  return request('/api/ai/report/findings?' + qs.toString(), { token });
};
