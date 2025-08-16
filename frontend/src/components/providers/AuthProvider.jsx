import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { me as apiMe } from '../../api/auth.js';
import { useServerHealth } from './ServerHealthProvider.jsx';

const AuthCtx = createContext(null);
export function AuthProvider({ token, children }) {
  const { serverDown, markSuccess, markFailure } = useServerHealth();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadedToken, setLoadedToken] = useState(token);

  const load = useCallback(async () => {
    if(!loadedToken || serverDown) return;
    setLoading(true); setError('');
    const r = await apiMe(loadedToken);
  if(r.ok){ setUser(r.data); markSuccess(); }
  else { setError(r.error ? 'auth: '+r.error : 'auth error'); setUser(null); markFailure(); }
    setLoading(false);
  }, [loadedToken, serverDown, markSuccess, markFailure]);

  useEffect(()=>{ setLoadedToken(token); },[token]);
  useEffect(()=>{ load(); },[load]);

  // Periodic refresh (e.g., role changes) every 2 minutes when active
  useEffect(()=>{ if(!loadedToken) return; let id; const loop=async()=>{ await load(); id=setTimeout(loop, 120000); }; loop(); return ()=> clearTimeout(id); },[loadedToken, load]);

  const value = React.useMemo(()=> ({ user, loading, error, refresh: load }), [user, loading, error, load]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export function useAuth(){ const c = useContext(AuthCtx); if(!c) throw new Error('useAuth must be inside AuthProvider'); return c; }
