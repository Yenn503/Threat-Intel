import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, Scans, ScanRecs, AIMessages, AITasks, AISettings } from '../db.js';
import { llmChat, llmEnabled } from '../llm_client.js';
import { tools, toolManifest, executeToolStep } from '../aiTools.js';
import { enqueueScan } from '../services/scanService.js';
import { planFromInstruction } from '../services/agentService.js';
import { sanitizePlan, validatePlanSteps } from '../planValidation.js';
import { normalizeMultiAgentPlan, listAgents } from '../services/orchestratorService.js';

// Extracted AI & Agent routes
export function registerAIRoutes(app, { authMiddleware, adminMiddleware, record }) {
  const router = express.Router();

  // /api/ai/chat
  router.post('/chat', authMiddleware, async (req, res) => {
    const { message } = req.body || {}; if(!message) return res.status(400).json({ error:'message required'});
    AIMessages.add(req.user.id,'user', message); AIMessages.truncate(req.user.id);
  const lastNmap = db.prepare("SELECT summary_json FROM scans WHERE user_id=? AND type='nmap' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(req.user.id);
  const lastNuclei = db.prepare("SELECT summary_json FROM scans WHERE user_id=? AND type='nuclei' AND status='completed' ORDER BY created_at DESC LIMIT 1").get(req.user.id);
    let nmapSummary={}, nucleiSummary={};
    try { nmapSummary = JSON.parse(lastNmap?.summary_json||'{}'); } catch{}
    try { nucleiSummary = JSON.parse(lastNuclei?.summary_json||'{}'); } catch{}
    const settings = AISettings.get();
    const system = `You are an application security scanning agent embedded in a SaaS platform.
Primary Goal: ${settings.goal}
Tone: ${settings.tone}
Guardrails: ${settings.guardrails}

Capabilities:
- Summarize & interpret recent scan results.
- Propose next minimal, high-signal scans.
- Only queue commands for nmap or nuclei when explicitly instructed.
- If user instruction matches pattern: scan target <HOST> with nmap|nuclei <flags> -> output ONLY fenced JSON: >>>JSON {"action":"queue-scan","tool":"nmap","target":"example.com","flags":"-F"} <<<JSON
Context Snapshot: Open ports: ${(nmapSummary.openPorts||[]).map(p=>p.port+'/'+p.service).join(', ')||'none'} | Findings: ${(nucleiSummary.findings||[]).length||0}`;
  const useLLM = llmEnabled() && !(process.env.NODE_ENV==='test' && process.env.ENABLE_LLM_TESTS!=='1');
  if(!useLLM) return res.json({ ok:true, reply:'LLM disabled. Set GEMINI_API_KEY.', history: AIMessages.recent(req.user.id) });
    const history = AIMessages.recent(req.user.id, 12);
    const llmMessages = history.map(h=> ({ role: h.role==='assistant'?'assistant':'user', content: h.content }));
    llmMessages.push({ role:'user', content: message });
    const out = await llmChat({ system, messages: llmMessages });
    let reply = out.content || '';
    const cmdMatch = reply.match(/>>>JSON([\s\S]*?)<<<JSON/);
    if(cmdMatch){
      try {
        const obj = JSON.parse(cmdMatch[1]);
        if(obj.action==='queue-scan' && ['nmap','nuclei'].includes(obj.tool) && obj.target){
          const kind = obj.tool; const target = obj.target; const flags = obj.flags||'';
          const baseBin = kind==='nmap'? (process.env.NMAP_PATH||'nmap') : (process.env.NUCLEI_PATH||'nuclei');
          const safeFlags = String(flags||'').replace(/[^A-Za-z0-9_:\-\s\/\.]/g,'');
          const cmd = kind==='nmap'? `${baseBin} -Pn -sV ${safeFlags} ${target}` : `${baseBin} -u ${target} ${safeFlags}`;
          const id = uuidv4();
          Scans.create({ id, user_id:req.user.id, target, type:kind, command:cmd });
          enqueueScan({ id, type:kind, command:cmd, target });
          record && record('scan_queued', req.user.id, { id, origin:'ai-json', kind, target });
          reply += `\n[Queued ${kind} scan ${id.slice(0,8)} for ${target}]`;
        }
      } catch {/* ignore */}
    }
    AIMessages.add(req.user.id,'assistant', reply);
    res.json({ ok:true, reply, history: AIMessages.recent(req.user.id) });
  });

  // history
  router.get('/history', authMiddleware, (req,res)=>{ res.json({ ok:true, history: AIMessages.recent(req.user.id) }); });
  router.get('/health', authMiddleware, (req,res)=>{ res.json({ ok:true, llm: llmEnabled() }); });
  router.get('/debug/llm', authMiddleware, (req,res)=>{
    const key = process.env.GEMINI_API_KEY||''; const masked = key? key.slice(0,6)+'...'+key.slice(-4):'';
    res.json({ ok:true, llm: llmEnabled(), model: process.env.GEMINI_MODEL||null, keyPresent: !!key, keyMasked: masked });
  });
  router.get('/tools', authMiddleware, (req,res)=>{ res.json({ ok:true, tools: toolManifest() }); });
  router.get('/agents', authMiddleware, (req,res)=>{ res.json({ ok:true, agents: listAgents() }); });

  // agent/chat autoplan
  router.post('/agent/chat', authMiddleware, async (req,res)=>{
    const { prompt, autoplan=true } = req.body || {}; if(!prompt) return res.status(400).json({ error:'prompt required'});
    AIMessages.add(req.user.id,'user', prompt);
    let plan=[]; let llmRaw='';
  if(useLLM){
      try {
        const manifest = toolManifest();
        const system = `You are a dual-mode security assistant. ALWAYS produce:\n1) A natural language answer for the user's prompt.\n2) If actionable tooling is helpful (running scans / summarizing), append a fenced JSON plan block delimited exactly by >>>PLAN and <<<PLAN containing an array of tool steps.\nOnly include the plan if it would advance the user's objective.\nDo not fabricate scan results.\nManifest:${JSON.stringify(manifest)}`;
        const out = await llmChat({ system, messages:[{ role:'user', content: prompt }] });
        llmRaw = out.content || '';
        const planMatch = llmRaw.match(/>>>PLAN([\s\S]*?)<<<PLAN/);
        if(planMatch){ try { plan = JSON.parse(planMatch[1]); } catch { plan=[]; } }
        if(!Array.isArray(plan)) plan=[];
      } catch(e){ llmRaw = '[LLM error] '+e.message.slice(0,120); }
    } else {
      llmRaw = '[LLM disabled: set GEMINI_API_KEY]';
    }
  if(!plan.length){
      const hostMatch = prompt.match(/\b([A-Za-z0-9_.-]{3,})\b/);
      if(hostMatch && /scan|nmap|recon|enumerate/i.test(prompt)){
        plan = [{ tool:'nmap_scan', args:{ target: hostMatch[1], flags:'-F' } }, { tool:'summarize_target', args:{ target: hostMatch[1] } }];
      }
    }
  plan = validatePlanSteps(plan.filter(s=> s && (s.tool? tools[s.tool]:true)), tools);
    const answerText = llmRaw.replace(/>>>PLAN[\s\S]*?<<<PLAN/g,'').trim();
    let executed=false; let taskId=null;
    if(plan.length && autoplan){
      const id = uuidv4(); taskId=id; executed=true;
      AITasks.create({ id, user_id:req.user.id, instruction: prompt });
      const steps = normalizeMultiAgentPlan(plan.map((s,i)=> ({ idx:i, status:'pending', tool:s.tool, args:s.args||{},
        ...(s.dependsOn? { dependsOn: Array.isArray(s.dependsOn)? s.dependsOn.slice(0,20): [] }:{}),
        ...(s.agent? { agent: s.agent }: {})
      })));
      AITasks.setPlan(id, steps);
      AIMessages.add(req.user.id,'assistant', answerText ? (answerText + `\n\n[Executing ${steps.length} step plan]`) : `Executing ${steps.length} step plan: ${steps.map(s=>s.tool).join(' -> ')}`);
    } else {
      const reply = plan.length? (answerText + `\n\nPlan suggested (${plan.length} step${plan.length>1?'s':''}) — enable Auto Plan or click Execute.`) : (answerText || 'No actionable scan plan derived. Provide a target to begin.');
      AIMessages.add(req.user.id,'assistant', reply);
    }
    return res.json({ ok:true, reply: answerText || (plan.length? 'Plan ready.' : 'Done'), plan: plan.length? plan: undefined, executed, taskId, history: AIMessages.recent(req.user.id) });
  });

  // agent/plan (LLM disabled fallback allowed)
  router.post('/agent/plan', authMiddleware, async (req,res)=>{
    const { instruction } = req.body || {}; if(!instruction) return res.status(400).json({ error:'instruction required'});
    const manifest = toolManifest();
    let plan=[]; let usedLLM=false;
  const useLLM = llmEnabled() && !(process.env.NODE_ENV==='test' && process.env.ENABLE_LLM_TESTS!=='1');
  if(useLLM){
      try {
        const system = `You are a planning assistant. Given a security reconnaissance instruction, output ONLY a fenced JSON plan.\nRules:\n- Use only tools from manifest.\n- Prefer nmap_scan -> nuclei_scan -> summarize_target.\n- Use dns_lookup first if target looks like a hostname and before scans.\n- Keep plan minimal and avoid duplicates.\n- Format: >>>PLAN [ {"tool":"nmap_scan","args":{"target":"scanme.nmap.org"}} ] <<<PLAN\nManifest: ${JSON.stringify(manifest)}`;
        const out = await llmChat({ system, messages:[{ role:'user', content: instruction }] });
        usedLLM=true;
        const m = out.content.match(/>>>PLAN([\s\S]*?)<<<PLAN/);
        if(m){ try { plan = JSON.parse(m[1]); } catch { plan=[]; } }
      } catch {/* swallow */}
    }
  if(!Array.isArray(plan) || !plan.length){
      const hostMatch = instruction.match(/([a-zA-Z0-9_.-]{3,})/);
      if(hostMatch){ plan = [{ tool:'nmap_scan', args:{ target: hostMatch[1], flags:'-F' } }, { tool:'summarize_target', args:{ target: hostMatch[1] } }]; }
    }
  plan = validatePlanSteps(plan.filter(s=> s && (s.tool? tools[s.tool]:true)), tools);
    res.json({ ok:true, plan, llm: usedLLM && llmEnabled() });
  });

  // agent/execute
  router.post('/agent/execute', authMiddleware, (req,res)=>{
    const { instruction, plan } = req.body || {}; if(!instruction || !Array.isArray(plan) || !plan.length) return res.status(400).json({ error:'instruction & plan required'});
  const filtered = validatePlanSteps(plan.filter(s=> s && (s.tool? tools[s.tool]:true)), tools); if(!filtered.length) return res.status(400).json({ error:'no valid steps'});
    const id = uuidv4();
    AITasks.create({ id, user_id:req.user.id, instruction });
    const steps = normalizeMultiAgentPlan(filtered.map((s,i)=> ({ idx:i, status:'pending', tool:s.tool, args:s.args||{},
      ...(s.dependsOn? { dependsOn: Array.isArray(s.dependsOn)? s.dependsOn.slice(0,20): [] }:{}),
      ...(s.agent? { agent: s.agent }: {})
    })));
    AITasks.setPlan(id, steps);
    res.json({ ok:true, task: AITasks.get(id) });
  });

  // settings
  router.get('/settings', authMiddleware, (req,res)=>{ res.json({ ok:true, settings: AISettings.get() }); });
  router.patch('/settings', authMiddleware, adminMiddleware, (req,res)=>{
    const allowed = (({ goal,tone,guardrails })=> ({ goal,tone,guardrails }))(req.body||{});
    const updated = AISettings.update(allowed);
    res.json({ ok:true, settings: updated });
  });

  // agent tasks CRUD
  router.post('/agent/tasks', authMiddleware, (req,res)=>{
    const { instruction } = req.body || {}; if(!instruction) return res.status(400).json({ error:'instruction required'});
    const plan = planFromInstruction(instruction);
    if(!plan) return res.status(400).json({ error:'unsupported instruction'});
    const id = uuidv4();
    AITasks.create({ id, user_id:req.user.id, instruction });
  // Tag steps with agents for forward compatibility
  const tagged = normalizeMultiAgentPlan(plan.map((s,i)=> ({ ...s, idx:i, ...(s.dependsOn? { dependsOn: Array.isArray(s.dependsOn)? s.dependsOn.slice(0,20): [] }:{}), ...(s.agent? { agent:s.agent }: {}) })));
  AITasks.setPlan(id, tagged);
    res.json({ ok:true, task: AITasks.get(id) });
  });
  router.get('/agent/tasks', authMiddleware, (req,res)=>{ res.json({ ok:true, tasks: AITasks.list(req.user.id) }); });
  router.get('/agent/tasks/:id', authMiddleware, (req,res)=>{ const t = AITasks.get(req.params.id); if(!t || t.user_id!==req.user.id) return res.status(404).json({ error:'not found'}); res.json({ ok:true, task:t }); });

  app.use('/api/ai', router);
}

export default registerAIRoutes;
