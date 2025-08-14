import React, { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);
export function ToastProvider({ children }){
  const [toasts,setToasts] = useState([]); // {id,type,msg}
  const push = useCallback((type,msg,opts={})=>{
    const id = Math.random().toString(36).slice(2);
    const ttl = opts.ttl ?? 4000;
    setToasts(ts=>{ const next=[...ts,{id,type,msg}]; if(next.length>5) next.shift(); return next; });
    if(ttl>0) setTimeout(()=> setToasts(ts=> ts.filter(t=>t.id!==id)), ttl);
    return id;
  },[]);
  const update = useCallback((id,msgOrFn,opts={})=>{
    setToasts(ts=> ts.map(t=> t.id===id ? { ...t, msg: typeof msgOrFn==='function'? msgOrFn(t.msg): msgOrFn, type: opts.type || t.type } : t));
    if(opts.ttl) setTimeout(()=> setToasts(ts=> ts.filter(t=> t.id!==id)), opts.ttl);
  },[]);
  const once = useCallback((key,type,msg,opts={})=>{
    const storageKey = 'ti_toast_once_'+key; if(localStorage.getItem(storageKey)) return; const id=push(type,msg,opts); setTimeout(()=> localStorage.setItem(storageKey,'1'),50); return id;
  },[push]);
  const api = { info:(m,o)=>push('info',m,o), success:(m,o)=>push('success',m,o), error:(m,o)=>push('error',m,o), update, once:(k,m,type='info',o)=> once(k,type,m,o) };
  return <ToastContext.Provider value={api}>{children}<div className="toasts">{toasts.map(t=> <Toast key={t.id} t={t} dismiss={()=> setToasts(ts=> ts.filter(x=>x.id!==t.id))} />)}</div></ToastContext.Provider>;
}
export function useToast(){ return useContext(ToastContext); }
function Toast({ t, dismiss }){ return <div className={'toast toast-'+t.type+' pop-in'} role="status" aria-live="polite"><div className="toast-icon">{t.type==='success'? '✔' : t.type==='error'? '✖' : 'ℹ'}</div><div style={{flex:1}}>{t.msg}</div><button className="toast-close" onClick={dismiss}>×</button></div>; }
export function Toasts(){ return null; }
