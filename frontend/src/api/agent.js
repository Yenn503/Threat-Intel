import { request } from './http';

// Agent / AI related endpoints
export const getAgentTools = token =>
  request('/api/ai/tools', { token });

export const getAgentHealth = token =>
  request('/api/ai/health', { token });

export const listAgentTasks = token =>
  request('/api/ai/agent/tasks', { token });

export const agentChat = (token, { prompt, autoplan }) =>
  request('/api/ai/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ prompt, autoplan }),
    token,
    headers: { 'Content-Type': 'application/json' },
  });

export const agentExecute = (token, { instruction, plan }) =>
  request('/api/ai/agent/execute', {
    method: 'POST',
    body: JSON.stringify({ instruction, plan }),
    token,
    headers: { 'Content-Type': 'application/json' },
  });

export const getRecentAgentEvents = token =>
  request('/api/ai/events/recent', { token });

export const getMetricsSnapshots = token =>
  request('/api/ai/metrics/snapshots', { token });
