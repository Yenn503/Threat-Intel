// Auth API helpers (restored)
import { httpJson } from './http.js';
const base = '/api/auth';
export const me = (token)=> httpJson(`${base}/me`, { token });
export const login = (email,password)=> httpJson(`${base}/login`, { method:'POST', body:{ email,password } });
export const register = (email,password)=> httpJson(`${base}/register`, { method:'POST', body:{ email,password } });

