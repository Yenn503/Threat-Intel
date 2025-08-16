import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import { logger } from '../logger.js';
import { Scans, ScanRecs, ValidationResults } from '../db.js';
import { TARGET_REGEX, targetAllowed } from '../constants.js';
import { checkTargetRateLimit } from '../rateLimiter.js';
import { buildScan } from '../aiTools.js';
import { enqueueScan } from '../services/scanService.js';

async function probeBinary(bin, args){
  return await new Promise(resolve=>{
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
    const startTs = Date.now();
    let spawned;
    try {
      spawned = spawn(bin, args, { stdio:['ignore','pipe','ignore'], shell: useShell });
    } catch (e){
      logger?.warn?.('probe_spawn_fail',{ bin, error:e.message });
      return resolve({ ok:false, spawnError:true });
    }
    let out=''; let done=false; const to=setTimeout(()=>{ if(!done){ try{ spawned.kill(); }catch{} logger?.warn?.('probe_timeout',{ bin, ms: Date.now()-startTs }); resolve({ ok:false, timeout:true }); } }, 7000);
    spawned.stdout.on('data',d=> out+=d.toString());
    spawned.on('error',e=>{ clearTimeout(to); done=true; logger?.warn?.('probe_error',{ bin, error:e.message }); resolve({ ok:false }); });
    spawned.on('close',code=>{ clearTimeout(to); done=true; const ms = Date.now()-startTs; logger?.info?.('probe_done',{ bin, code, ms }); resolve({ ok: !!out, exitCode:code, output: out.slice(0,160) }); });
  });
}

let binCache = { ts:0, data:null };

export function registerScanRoutes(app, authMiddleware, record){
  const router = express.Router();

  // Place static route before param route to avoid capture by :id
  router.get('/binaries', authMiddleware, async (req,res)=>{
    const now = Date.now();
    if(!binCache.data || (now - binCache.ts) > 30000){
      binCache.ts = now;
      const nmapBin = process.env.NMAP_PATH || 'nmap';
      const nucleiBin = process.env.NUCLEI_PATH || 'nuclei';
      const [nmap, nuclei] = await Promise.all([
        probeBinary(nmapBin, ['--version']),
        probeBinary(nucleiBin, ['-version'])
      ]);
      binCache.data = { nmapBin, nucleiBin, nmap, nuclei };
    }
    res.json({ ok:true, binaries: binCache.data });
  });

  router.post('/', authMiddleware, (req,res)=>{
    const { target, kind, flags } = req.body || {};
    if(!target || !kind) return res.status(400).json({ error:'target & kind required'});
  if(!TARGET_REGEX.test(target)) return res.status(400).json({ error:'invalid target'});
  if(!targetAllowed(target)) return res.status(403).json({ error:'target not allowed'});
    if(!['nmap','nuclei'].includes(kind)) return res.status(400).json({ error:'unsupported kind'});
    const rl = checkTargetRateLimit(target);
    if(!rl.allowed){
      return res.status(429).json({ error:'rate limit: target scan quota exceeded', limit: rl.limit, recent: rl.recent });
    }
    const cmd = buildScan(kind, target, flags||'');
    const id = uuidv4();
    const rec = Scans.create({ id, user_id:req.user.id, target, type:kind, command:cmd });
    enqueueScan({ id, type:kind, command:cmd, target });
    record && record('scan_queued', req.user.id, { id, kind, target });
    res.json({ ok:true, scan: rec });
  });

  router.get('/:id', authMiddleware, (req,res)=>{
    const s = Scans.get(req.params.id); if(!s) return res.status(404).json({ error:'not found'});
    const recs = ScanRecs.listForScan(s.id);
    res.json({ ok:true, scan:s, recommendations: recs });
  });

  router.get('/', authMiddleware, (req,res)=>{ res.json({ ok:true, scans: Scans.list(200) }); });

  // Validation stats per target
  router.get('/validation/:target', authMiddleware, (req,res)=>{
    const { target } = req.params;
    if(!targetAllowed(target)) return res.status(403).json({ error:'target not allowed'});
    try {
      const rows = ValidationResults.statsForTarget(target);
      let total=0, validated=0, invalid=0;
      for(const r of rows){ total += r.c; if(r.validated) validated = r.c; else invalid = r.c; }
      res.json({ ok:true, target, stats:{ total, validated, invalid } });
    } catch(e){ res.status(500).json({ error:'stats error' }); }
  });

  // Legacy plural endpoint compatibility
  app.get('/api/scans', authMiddleware, (req,res)=>{ res.json({ ok:true, scans: Scans.list(200) }); });

  app.use('/api/scan', router);
}

export default registerScanRoutes;
