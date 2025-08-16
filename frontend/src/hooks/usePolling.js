// Restored polling hook with simple failure backoff
import { useEffect, useRef } from 'react';
export function usePolling(fn, { interval=5000, enabled=true, immediate=true }={}){
	const ref = useRef({ fail:0, timer:null, stopped:false });
	useEffect(()=>{
		if(!enabled) return; ref.current.stopped=false;
		const run = async()=>{
			try { await fn(); ref.current.fail=0; }
			catch { ref.current.fail++; }
			if(ref.current.stopped) return;
			const backoff = Math.min(ref.current.fail, 5) * 1000; // linear backoff up to +5s
			ref.current.timer = setTimeout(run, interval + backoff);
		};
		if(immediate) run(); else ref.current.timer = setTimeout(run, interval);
		return ()=> { ref.current.stopped=true; if(ref.current.timer) clearTimeout(ref.current.timer); };
	},[fn, interval, enabled, immediate]);
}

