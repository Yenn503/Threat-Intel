import { request } from './http';

export const listTechniques = token =>
  request('/api/techniques', { token });

export const getTechnique = (token, id) =>
  request(`/api/techniques/${id}`, { token });

export const createTechnique = (token, payload) =>
  request('/api/techniques', {
    method: 'POST',
    body: JSON.stringify(payload),
    token,
    headers: { 'Content-Type': 'application/json' },
  });

export const updateTechnique = (token, id, payload) =>
  request(`/api/techniques/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    token,
    headers: { 'Content-Type': 'application/json' },
  });

export const deleteTechnique = (token, id) =>
  request(`/api/techniques/${id}`, {
    method: 'DELETE',
    token,
  });

export const getVersions = (token, id) =>
  request(`/api/techniques/${id}/versions`, { token });

export const revertVersion = (token, id, index) =>
  request(`/api/techniques/${id}/revert`, {
    method: 'POST',
    body: JSON.stringify({ index }),
    token,
    headers: { 'Content-Type': 'application/json' },
  });

export const updateStatus = (token, id, status) =>
  request(`/api/techniques/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
    token,
    headers: { 'Content-Type': 'application/json' },
  });
