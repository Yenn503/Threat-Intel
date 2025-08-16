// Restored reconnecting WebSocket hook
import { useEffect, useRef, useCallback } from 'react';
export function useReconnectingWebSocket(url, { onMessage, onOpen, onClose, enabled=true, maxDelay=15000 }={}){
	const ref = useRef({ ws:null, attempts:0, manual:false });
	const cleanup = ()=>{ if(ref.current.ws){ ref.current.ws.onopen = ref.current.ws.onclose = ref.current.ws.onmessage = null; try { ref.current.ws.close(); } catch(_){} ref.current.ws=null; } };
	const connect = useCallback(()=>{
		if(!enabled || ref.current.ws) return; ref.current.manual=false;
		const ws = new WebSocket(url);
		ref.current.ws = ws;
		ws.onopen = (e)=>{ ref.current.attempts=0; onOpen && onOpen(e); };
		ws.onmessage = (e)=>{ onMessage && onMessage(e); };
		ws.onclose = ()=>{ onClose && onClose(); if(!ref.current.manual && enabled){ ref.current.ws=null; ref.current.attempts++; const delay = Math.min( (2 ** ref.current.attempts) * 500, maxDelay); setTimeout(connect, delay); } };
	},[url, enabled, onMessage, onOpen, onClose, maxDelay]);
	useEffect(()=>{ if(enabled) connect(); return ()=> cleanup(); },[connect, enabled]);
	const send = useCallback((data)=>{ if(ref.current.ws && ref.current.ws.readyState===1) ref.current.ws.send(data); },[]);
	const close = useCallback(()=>{ ref.current.manual=true; cleanup(); },[]);
	return { send, close };
}

