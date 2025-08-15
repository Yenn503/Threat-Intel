// Express server (normalized path casing)
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { spawn } from 'child_process';
import { db, Users, Techniques, Activity, seedAdmin, Scans, ScanRecs, AIMessages, AITasks, AISettings } from './db.js';
import { llmChat, llmEnabled } from './llm_client.js';
import EventEmitter from 'events';
import net from 'net';
import { promises as dns } from 'dns';
import pLimit from 'p-limit';

dotenv.config();

const app = express();
app.use(cors({ origin:true, credentials:true }));
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'","'unsafe-inline'"],
      "style-src": ["'self'","'unsafe-inline'"],
      "connect-src": ["'self'","ws://localhost:4000"],
      "img-src": ["'self'","data:"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.json({ limit: '512kb' }));

// DB initialization
seedAdmin(bcrypt);
const hibpUsage = new Map();
const metrics = { logins:0, hibpQueries:0, cveSearches:0, terminalSessions:0, terminalCommands:0, techniqueCreates:0, techniqueUpdates:0, techniqueDeletes:0 };
function record(type, userId, meta={}){ Activity.record(type, userId, meta); }

// Basic payload sanitation (remove null bytes / overly long string fields)
app.use((req,res,next)=>{
  if(req.body && typeof req.body === 'object'){
    for(const k of Object.keys(req.body)){
      if(typeof req.body[k] === 'string'){
        req.body[k] = req.body[k].replace(/\0/g,'').trim();
        if(req.body[k].length > 20000) req.body[k] = req.body[k].slice(0,20000);
      }
    }
  }
  next();
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Missing Authorization header' });
  const token = header.replace('Bearer ','');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
  req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email & password required' });
  const user = Users.findByEmail(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  Users.incrementLogin(user.id); metrics.logins++; record('login', user.id);
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// Simple registration (optional)
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email & password required' });
  try {
  if (Users.findByEmail(email)) return res.status(400).json({ error: 'Email already exists' });
  const u = Users.create({ email, password_hash: bcrypt.hashSync(password,10), role:'user' });
  record('register', u.id);
  const token = jwt.sign({ sub: u.id, email: u.email, role:'user' }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token });
  } catch (e) {
    res.status(400).json({ error: 'Registration failed', detail: e.message });
  }
});

// Current user info
app.get('/api/auth/me', authMiddleware, (req,res)=>{
  const userObj = Users.findById(req.user.id);
  if(!userObj) return res.status(404).json({ error: 'User not found'});
  res.json({ id: userObj.id, email: userObj.email, role: userObj.role });
});

function adminMiddleware(req,res,next){
  const userObj = Users.findById(req.user.id);
  if(!userObj) return res.status(401).json({ error:'User missing' });
  if(userObj.role !== 'admin') return res.status(403).json({ error:'Admin only' });
  next();
}

// Rate limit per IP general (not tier specific)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120
});
app.use(generalLimiter);

// --- Scan & AI Agent Section ---
import { tools, toolManifest, executeToolStep, buildScan } from './aiTools.js';
import { TARGET_REGEX } from './constants.js';
import scanService, { enqueueScan } from './services/scanService.js';
import registerScanRoutes from './routes/scanRoutes.js';
import registerAIRoutes from './routes/aiRoutes.js';
import { startAgentLoop } from './services/agentService.js';
// Register externalized route groups
registerScanRoutes(app, authMiddleware, record);
registerAIRoutes(app, { authMiddleware, adminMiddleware, record });
startAgentLoop();

// Basic parsers
// parseNmap / parseNuclei / deriveScore now sourced from scanService

// Scan execution moved to scanService

// (AI routes & agent loop moved to routes/aiRoutes.js and services/agentService.js)

// HIBP email search with per-user global limit (no tiers) - configure env: HIBP_MAX_PER_MINUTE, HIBP_MAX_BATCH
const HIBP_MAX_PER_MINUTE = parseInt(process.env.HIBP_MAX_PER_MINUTE || '10',10);
const HIBP_MAX_BATCH = parseInt(process.env.HIBP_MAX_BATCH || '10',10);

app.post('/api/hibp/search', authMiddleware, async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) return res.status(400).json({ error: 'emails array required' });
  if (emails.length > HIBP_MAX_BATCH) return res.status(400).json({ error: `Batch limit exceeded (${HIBP_MAX_BATCH})` });
  const minuteWindow = Math.floor(Date.now() / 60000);
  const key = `${req.user.id}:${minuteWindow}`;
  const used = hibpUsage.get(key) || 0;
  if (used + emails.length > HIBP_MAX_PER_MINUTE) return res.status(429).json({ error: 'Rate limit exceeded' });
  hibpUsage.set(key, used + emails.length);
  const apiKey = process.env.HIBP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'HIBP_API_KEY not configured' });
  const results = {};
  for (const email of emails) {
    try {
      const r = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`, {
        headers: { 'hibp-api-key': apiKey, 'user-agent': 'ThreatIntelApp/0.2' }
      });
      if (r.status === 404) results[email] = [];
      else if (!r.ok) results[email] = { error: r.status };
      else results[email] = await r.json();
    } catch (e) { results[email] = { error: e.message }; }
  }
  metrics.hibpQueries += emails.length; record('hibp_search', req.user.id, { count: emails.length });
  res.json({ results });
});

// HIBP configuration exposure (frontend can adapt pacing)
app.get('/api/hibp/config', authMiddleware, (req, res) => {
  res.json({ perMinute: HIBP_MAX_PER_MINUTE, batchLimit: HIBP_MAX_BATCH });
});

// DeHashed integration stub
app.post('/api/dehashed/search', authMiddleware, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  const { DEHASHED_KEY, DEHASHED_EMAIL } = process.env;
  if (!DEHASHED_KEY || !DEHASHED_EMAIL) {
    return res.status(500).json({ error: 'DeHashed credentials not configured' });
  }
  try {
    const r = await fetch(`https://api.dehashed.com/search?query=${encodeURIComponent(query)}`, {
      headers: {
        Accept: 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${DEHASHED_EMAIL}:${DEHASHED_KEY}`).toString('base64')
      }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CVE lookup (NVD - requires API key for heavy usage; simple pass-through)
// In-memory cache for CVE lookups
const cveCache = new Map(); // key -> { expires, data }
const CVE_TTL_MS = 5 * 60 * 1000;

app.get('/api/cve/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
  const key = `id:${id}`;
  const cached = cveCache.get(key);
  if (cached && cached.expires > Date.now()) return res.json(cached.data);
  const r = await fetch(`https://services.nvd.nist.gov/rest/json/cve/2.0/${encodeURIComponent(id)}`);
  if (!r.ok) return res.status(r.status).json({ error: 'Lookup failed' });
  const data = await r.json();
  cveCache.set(key, { expires: Date.now() + CVE_TTL_MS, data });
  metrics.cveSearches++; record('cve_lookup', req.user.id, { id });
  res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CVE search by keyword
app.get('/api/cve', authMiddleware, async (req, res) => {
  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  try {
  const key = `kw:${keyword}`;
  const cached = cveCache.get(key);
  if (cached && cached.expires > Date.now()) return res.json(cached.data);
  const r = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}`);
  const data = await r.json();
  cveCache.set(key, { expires: Date.now() + CVE_TTL_MS, data });
  metrics.cveSearches++; record('cve_search', req.user.id, { keyword });
  res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WHOIS lookup
// Minimal WHOIS lookup (no external dependency). Basic referral follow for .com/.net.
async function rawWhoisQuery(server, query){
  return new Promise((resolve,reject)=>{
    let out='';
    const sock = net.createConnection(43, server, ()=> sock.write(query+"\r\n"));
    sock.setTimeout(7000);
    sock.on('data', d=> out += d.toString('utf8'));
    sock.on('end', ()=> resolve(out));
    sock.on('error', reject);
    sock.on('timeout', ()=> { sock.destroy(); reject(new Error('whois timeout')); });
  });
}
function pickBaseServer(target){
  if(/\.uk$/i.test(target)) return 'whois.nic.uk';
  if(/\.(com|net)$/i.test(target)) return 'whois.verisign-grs.com';
  if(/\.org$/i.test(target)) return 'whois.pir.org';
  return 'whois.iana.org';
}
function parseWhois(raw){
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const kv = {}; lines.forEach(l=>{ const m = l.match(/^([^:]+):\s*(.*)$/); if(m){ const k=m[1].trim(); const v=m[2].trim(); if(!kv[k]) kv[k]=v; else if(Array.isArray(kv[k])) kv[k].push(v); else kv[k]=[kv[k],v]; } });
  return { fields: kv, lineCount: lines.length };
}
app.get('/api/assess/whois', authMiddleware, async (req,res)=>{
  let { target } = req.query; if(!target) return res.status(400).json({ error:'target required'});
  target = String(target).trim().replace(/^https?:\/\//i,'').split(/[\/#?]/)[0];
  if(!/^[A-Za-z0-9.-]{1,253}$/.test(target)) return res.status(400).json({ error:'invalid target'});
  try {
    const base = pickBaseServer(target);
    let raw = await rawWhoisQuery(base, target);
    // Referral follow
    const refMatch = raw.match(/Whois Server:\s*(\S+)/i);
    if(refMatch && !/whois.verisign-grs.com/i.test(refMatch[1])){
      try { raw = await rawWhoisQuery(refMatch[1], target); } catch { /* keep original */ }
    }
    const parsed = parseWhois(raw);
    // Extract summary fields
    const summary = {};
    const grab = (label, regexArr) => { for(const r of regexArr){ const m = raw.match(r); if(m){ summary[label] = m[1].trim(); return; } } };
    grab('domain', [new RegExp('Domain Name:\\s*([^\\r\\n]+)','i'), new RegExp('Domain:\\s*([^\\r\\n]+)','i')]);
    grab('registrar', [/Registrar:\s*([^\r\n]+)/i]);
    grab('created', [/Creation Date:\s*([^\r\n]+)/i, /Registered on:\s*([^\r\n]+)/i]);
    grab('updated', [/Updated Date:\s*([^\r\n]+)/i, /Last updated:\s*([^\r\n]+)/i]);
    grab('expires', [/Registry Expiry Date:\s*([^\r\n]+)/i, /Expiry date:\s*([^\r\n]+)/i]);
    const nsMatches = raw.match(/Name Server:\s*([^\r\n]+)/ig); if(nsMatches){ summary.nameServers = nsMatches.map(l=>l.split(/:\s*/)[1]).slice(0,8); }
    const statusMatches = raw.match(/Domain Status:\s*([^\r\n]+)/ig); if(statusMatches){ summary.status = statusMatches.map(s=>s.split(/:\s*/)[1]).slice(0,5); }
    // Error message detection (e.g., Nominet invalid multi-part)
    let errorMessage = '';
    const errMatch = raw.match(/Error for "([^"]+)"\.[\r\n]+([\s\S]*?)(?:WHOIS lookup|--|$)/i);
    if(errMatch){
      const msgBlock = errMatch[2].split(/\r?\n/).map(l=>l.trim()).filter(l=>l).join(' ');
      errorMessage = msgBlock;
    }
    // Disclaimer extraction
    let disclaimer='';
    const discIdx = raw.search(/This WHOIS information is provided/i);
    if(discIdx !== -1){ disclaimer = raw.slice(discIdx).trim(); }
    record('whois_lookup', req.user.id, { t: target });
    res.json({ ok:true, data:{ target, server:base, raw: raw.slice(0,20000), parsed, summary, errorMessage, disclaimer } });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// Shodan host info (requires SHODAN_KEY in env)
app.get('/api/assess/shodan', authMiddleware, async (req,res)=>{
  let { ip, domain } = req.query;
  const key = process.env.SHODAN_KEY; if(!key) return res.status(500).json({ error:'SHODAN_KEY not configured'});
  async function fetchHost(ipAddr){
    const r = await fetch(`https://api.shodan.io/shodan/host/${encodeURIComponent(ipAddr)}?key=${key}`);
    if(!r.ok) return { ip: ipAddr, error:'lookup failed', status:r.status };
    const data = await r.json();
    return { ip: ipAddr, data };
  }
  try {
    if(domain && !ip){
      domain = domain.replace(/^https?:\/\//i,'').split(/[\/#?]/)[0];
      let addresses = [];
      try { const look = await dns.lookup(domain,{ all:true }); addresses = look.map(r=>r.address); } catch { return res.status(400).json({ error:'dns resolution failed'}); }
      addresses = [...new Set(addresses)].slice(0,5);
      const results = [];
      for(const a of addresses){ results.push(await fetchHost(a)); }
      record('shodan_lookup', req.user.id, { domain, count: results.length });
      return res.json({ ok:true, domain, hosts: results });
    }
    if(!ip) return res.status(400).json({ error:'ip or domain required'});
    const single = await fetchHost(ip);
    record('shodan_lookup', req.user.id, { ip });
    return res.json({ ok:true, hosts:[single] });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// --- WordPress Plugin Heuristic Detection ---
const wpPluginCache = new Map(); // key -> { expires, data }
const WP_CACHE_TTL = 10 * 60 * 1000;
function normHost(h){ return h.trim().replace(/^https?:\/\//i,'').split(/[\/#?]/)[0]; }
async function timedFetch(url, opts={}){
  const controller = new AbortController();
  const to = setTimeout(()=> controller.abort(), opts.timeout || 8000);
  try {
    const r = await fetch(url, { signal: controller.signal, redirect:'follow', headers: opts.headers });
    clearTimeout(to);
    return r;
  } catch(e){ clearTimeout(to); throw e; }
}
app.get('/api/assess/wpplugins', authMiddleware, async (req,res)=>{
  let { target, deep, extra } = req.query;
  if(!target) return res.status(400).json({ error:'target required' });
  target = normHost(String(target));
  if(!/^[A-Za-z0-9.-]{1,253}$/.test(target)) return res.status(400).json({ error:'invalid target'});
  const cacheKey = target + ':' + (deep?'1':'0');
  const cached = wpPluginCache.get(cacheKey); if(cached && cached.expires > Date.now()){ return res.json({ ok:true, cached:true, target, plugins: cached.data.plugins, fetchedAt: cached.data.fetchedAt }); }
  const attempt = [`https://${target}`, `http://${target}`];
  let html='', finalUrl='', status=0, error='';
  for(const base of attempt){
    try {
      const r = await timedFetch(base, { timeout:8000 });
      status = r.status; finalUrl = r.url; html = await r.text();
      if(status>=200 && status<400 && html.length>0) break; else html='';
    } catch(e){ error = e.message; }
  }
  if(!html) return res.json({ ok:false, target, error: error || ('fetch failed status '+status) });
  if(html.length>600000) html = html.slice(0,600000);
  // Quick CMS fingerprint to avoid false negatives (e.g., Joomla returning no plugin paths)
  const lowerHtml = html.toLowerCase();
  const metaGenerator = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["'][^>]*>/i)||[])[1] || '';
  const isWordPress = /wp-content\//.test(lowerHtml) || /wp-includes\//.test(lowerHtml) || /wordpress/i.test(metaGenerator);
  if(!isWordPress){
    return res.json({ ok:true, target, url: finalUrl, status, plugins: [], notWordPress:true, reason:'No WordPress signatures (wp-content/wp-includes/meta generator) detected in initial HTML', fetchedAt: Date.now() });
  }
  // Signature-based plugin detection (patterns & optional REST endpoints) enriched from provided signature dataset
  const pluginSignatures = {
    'woocommerce': { patterns:[/woocommerce\./i, /wc-cart-fragments/i, /\/wc-(product|cart|block)/i, /plugins\/woocommerce\//i, /body\.woocommerce(-page)?/i], rest:['/wp-json/wc/v3/'] },
    'wordfence': { patterns:[/wordfence/i, /wordfence-waf\.php/i, /wflogs/i], rest:[] },
    'elementor': { patterns:[/elementor-(frontend|min)\.js/i, /data-elementor-id/i, /\.elementor-/i, /elementorFrontend/i], rest:['/wp-json/elementor/v1/'] },
    'yoast-seo': { patterns:[/yoast[- ]seo|wpseo_/i, /yoast-schema-graph/i], rest:['/wp-json/yoast/v1/'] },
    'jetpack': { patterns:[/jetpack\.(min\.)?js/i, /jetpack_wordpress\.com/i, /public-api\.wordpress\.com/i, /jetpack_css-css/i], rest:['/wp-json/jetpack/v4/'] },
    'akismet': { patterns:[/akismet/i, /akismet_result/i], rest:[] },
    'wpforms-lite': { patterns:[/wpforms/i], rest:[] },
    'wp-super-cache': { patterns:[/wp-super-cache|wpcache/i], rest:[] },
    'all-in-one-seo-pack': { patterns:[/all-in-one-seo-pack|aioseop/i], rest:[] },
    'contact-form-7': { patterns:[/contact-form-7|wpcf7/i, /\.wpcf7(\W|_)/i], rest:['/wp-json/contact-form-7/v1/contact-forms/'] },
    'master-slider': { patterns:[/master-slider|minified|ms-layer/i], rest:[] },
    'wordpress-popup': { patterns:[/wordpress-popup|popup-maker|pum-site-scripts/i], rest:[] },
    'wp-meta-and-date-remover': { patterns:[/meta-and-date-remover/i], rest:[] },
    'revslider': { patterns:[/revslider|plugins\/revslider\//i, /tp-tools/i], rest:[] },
    'layerslider': { patterns:[/layerslider/i], rest:[] },
    'gravityforms': { patterns:[/plugins\/gravityforms\//i, /gform_wrapper/i], rest:[] },
    'advanced-custom-fields': { patterns:[/acf-input|plugins\/advanced-custom-fields\//i, /acf-field/i, /acf\/v3\//i], rest:['/wp-json/acf/v3/'] },
    'tablepress': { patterns:[/tablepress/i], rest:[] },
    'ninja-forms': { patterns:[/ninja-forms/i], rest:[] },
    'wpbakery': { patterns:[/wpb_wrapper|js_composer/i], rest:[] },
    'slim-seo': { patterns:[/slim-seo/i], rest:[] },
    'polylang': { patterns:[/polylang/i], rest:[] },
    'wpml': { patterns:[/sitepress-multilingual|wpml/i], rest:[] },
    'updraftplus': { patterns:[/updraftplus/i], rest:[] },
    'imagify': { patterns:[/imagify/i], rest:[] },
    'wordlift': { patterns:[/wordlift/i], rest:[] },
    'all-in-one-wp-migration': { patterns:[/ai1wm-backups/i, /\.wpress/i], rest:[] },
    'jetpack-portfolio': { patterns:[/jetpack-portfolio/i], rest:[] },
    'acf': { patterns:[/acf-field-group|acf-field/i], rest:['/wp-json/acf/v3/'] },
    'wp-mail-smtp': { patterns:[/wp_mail_smtp/i], rest:[] },
    'learnpress': { patterns:[/learnpress/i, /lp_course/i], rest:['/wp-json/lp/v1/'] },
  'the-events-calendar': { patterns:[/tribe-events/i, /tribe_events_views_v2/i], rest:['/wp-json/tribe/events/v1/'] },
  // Analytics focused plugins (expanded)
  'google-analytics-for-wordpress': { patterns:[/google-analytics-for-wordpress/i, /monsterinsights/i, /exactmetrics/i], rest:[] },
  'exactmetrics': { patterns:[/exactmetrics/i, /ga\.exactmetrics/i], rest:[] },
  'google-site-kit': { patterns:[/google-site-kit|googlesitekit/i, /id="google-site-kit/i], rest:['/wp-json/google-site-kit/v1/core/site/data/connection'] },
  'matomo': { patterns:[/matomo\.js/i, /piwik\.php/i, /plugins\/matomo\//i], rest:[] },
  'ga-google-analytics': { patterns:[/ga-google-analytics/i], rest:[] },
  'wp-statistics': { patterns:[/wp-statistics/i], rest:[] },
  'analytify': { patterns:[/wp-analytify|analytify/i], rest:[] },
  'gtm4wp': { patterns:[/gtm4wp/i, /duracelltomi-google-tag-manager/i], rest:[] },
  'duracelltomi-google-tag-manager': { patterns:[/duracelltomi-google-tag-manager/i], rest:[] },
  'pixel-cat': { patterns:[/pixel-cat/i], rest:[] }
  };
  const pluginRegex = /\/wp-content\/plugins\/([a-zA-Z0-9_-]+)\//g;
  const evidenceMap = new Map();
  let m; let maxMatches=5000; let scanCount=0;
  while((m = pluginRegex.exec(html)) && scanCount<maxMatches){
    scanCount++;
    const slug = m[1].toLowerCase();
    if(!evidenceMap.has(slug)) evidenceMap.set(slug, []);
    // Capture surrounding snippet
    const start = Math.max(0, m.index-60); const end = Math.min(html.length, m.index+60);
    evidenceMap.get(slug).push(html.slice(start,end));
  }
  const slugs = [...evidenceMap.keys()].slice(0,150); // safety cap
  const results = slugs.map(s=> ({ slug:s, evidence: evidenceMap.get(s).slice(0,6), source:'path' }));
  // Apply signature detection for plugins not yet found
  Object.entries(pluginSignatures).forEach(([slug, sig])=>{
    if(results.some(r=>r.slug===slug)) return; // already captured by path
    const patterns = sig.patterns || [];
    let hits = [];
    for(const re of patterns){ const match = lowerHtml.match(re); if(match){ hits.push(match[0]); if(hits.length>=5) break; } }
    if(hits.length){
      results.push({ slug, evidence: hits.slice(0,5), signature:true, source:'signature' });
    }
  });
  // Deep verification: HEAD/GET readme.txt or main plugin path to raise confidence & version extraction
  if(deep==='1' && results.length){
    const limit = pLimit(5);
    await Promise.all(results.map(r=> limit(async ()=>{
      try {
        // Attempt readme.txt
        const readmeUrl = `https://${target}/wp-content/plugins/${r.slug}/readme.txt`;
        const head = await timedFetch(readmeUrl, { timeout:5000 });
        if(head.status===200){
          const txt = await head.text();
          r.readme = true;
          const verMatch = txt.match(/Stable tag:\s*(\S+)/i) || txt.match(/Version:\s*(\S+)/i);
            if(verMatch) r.version = verMatch[1];
        } else if([401,403,301,302,500].includes(head.status)){
          r.protected = true; // existence likely
        }
      } catch {}
    })));
    // REST endpoint probing for additional confirmation where defined
    await Promise.all(results.map(r=> limit(async ()=>{
      if(r.restVerified) return;
      const sig = pluginSignatures[r.slug]; if(!sig || !sig.rest || !sig.rest.length) return;
      for(const ep of sig.rest.slice(0,3)){
        try {
          const restUrl = `https://${target}${ep}`;
          const resp = await timedFetch(restUrl,{ timeout:4000 });
          if(resp.status===200){ r.restVerified = true; r.evidence = (r.evidence||[]).concat(['rest:'+ep]).slice(0,8); break; }
          if([401,403].includes(resp.status)){ r.restProtected = true; r.evidence = (r.evidence||[]).concat(['rest-protected:'+ep]).slice(0,8); break; }
        } catch {}
      }
    })));
  }
  // Enumeration fallback: if deep mode requested, site looks WP, but no plugin paths referenced, try a tiny curated plugin list
  if(deep==='1' && results.length===0){
    let common = ['contact-form-7','woocommerce','wordfence','elementor','yoast-seo','akismet','jetpack','all-in-one-seo-pack','wpforms-lite','wp-super-cache','gravityforms','advanced-custom-fields','revslider','layerslider','wpbakery'];
    if(extra){
      const add = String(extra).split(/[,;\s]+/).map(s=>s.trim().toLowerCase()).filter(Boolean).slice(0,50);
      common = [...new Set([...common, ...add])];
    }
    const limit = pLimit(5);
    const foundEnum = [];
    await Promise.all(common.map(slug=> limit(async ()=>{
      try {
        const readmeUrl = `https://${target}/wp-content/plugins/${slug}/readme.txt`;
        const r = await timedFetch(readmeUrl,{ timeout:4000 });
        if(r.status===200){
          const txt = await r.text();
          const verMatch = txt.match(/Stable tag:\s*(\S+)/i) || txt.match(/Version:\s*(\S+)/i);
          foundEnum.push({ slug, evidence:['enumerated readme'], readme:true, version: verMatch? verMatch[1]:undefined, source:'enumerated' });
        } else if([401,403].includes(r.status)){
          foundEnum.push({ slug, evidence:[`/wp-content/plugins/${slug}/ (protected)`], protected:true, source:'enumerated' });
        }
      } catch {}
    })));
    if(foundEnum.length){
      foundEnum.forEach(f=> results.push(f));
    }
  }
  // Confidence scoring
  results.forEach(r=>{
    let conf = 0.55; // base path
    if(r.signature && !r.readme && r.source==='signature'){ conf = 0.42 + Math.min(0.18, (r.evidence.length-1)*0.04); }
    if(r.readme) conf += 0.3;
    else if(r.protected) conf += 0.15;
    if(r.restVerified) conf += 0.25;
    else if(r.restProtected) conf += 0.1;
    if(r.version) conf += 0.05;
    conf = Math.min(0.995, conf);
    r.confidence = Number(conf.toFixed(3));
  if(r.restVerified) r.restStatus = 'verified'; else if(r.restProtected) r.restStatus = 'protected';
  delete r.protected; delete r.restProtected;
  });
  // Friendly alias display names (canonical plugin branding)
  const aliasMap = {
    'google-analytics-for-wordpress':'MonsterInsights (Google Analytics)',
  'exactmetrics':'MonsterInsights (Legacy ExactMetrics)',
    'all-in-one-seo-pack':'All in One SEO',
    'yoast-seo':'Yoast SEO',
    'wpforms-lite':'WPForms',
    'revslider':'Revolution Slider',
    'wp-super-cache':'WP Super Cache',
    'advanced-custom-fields':'Advanced Custom Fields',
  'all-in-one-wp-migration':'All-in-One WP Migration',
  'google-site-kit':'Site Kit by Google',
  'matomo':'Matomo (Self‑Hosted Analytics)',
  'ga-google-analytics':'GA Google Analytics',
  'wp-statistics':'WP Statistics',
  'analytify':'Analytify (Google Analytics)',
  'gtm4wp':'Google Tag Manager for WP',
  'duracelltomi-google-tag-manager':'Google Tag Manager for WP',
  'pixel-cat':'Pixel Cat (Facebook Pixel)'
  };
  results.forEach(r=>{ if(aliasMap[r.slug]){ r.name = aliasMap[r.slug]; r.originalSlug = r.slug; } });
  const payload = { ok:true, target, url: finalUrl, status, plugins: results, fetchedAt: Date.now() };
  wpPluginCache.set(cacheKey, { expires: Date.now()+WP_CACHE_TTL, data: payload });
  record('wp_plugins_scan', req.user.id, { t: target, count: results.length });
  res.json(payload);
});

// --- Generic Technology Fingerprint (CMS / libs / headers) ---
const fpCache = new Map(); // key -> { expires, data }
const FP_TTL = 5 * 60 * 1000;
function cleanTarget(t){ return t.trim().replace(/^https?:\/\//i,'').split(/[\/#?]/)[0]; }
app.get('/api/assess/fingerprint', authMiddleware, async (req,res)=>{
  let { target, deep } = req.query;
  if(!target) return res.status(400).json({ error:'target required' });
  target = cleanTarget(String(target));
  if(!/^[A-Za-z0-9.-]{1,253}$/.test(target)) return res.status(400).json({ error:'invalid target'});
  const cacheKey = target+':' + (deep?'1':'0');
  const cached = fpCache.get(cacheKey); if(cached && cached.expires>Date.now()) return res.json({ ...cached.data, cached:true });
  const attempt = [`https://${target}`, `http://${target}`];
  let html='', status=0, finalUrl='', headers=null, fetchErr='';
  for(const base of attempt){
    try {
      const r = await timedFetch(base, { timeout:8000 });
      status = r.status; finalUrl = r.url; headers = r.headers; html = await r.text();
      if(status>=200 && status<400 && html) break; else html='';
    } catch(e){ fetchErr = e.message; }
  }
  if(!html){ return res.json({ ok:false, target, error: fetchErr || ('fetch failed status '+status) }); }
  if(html.length>800000) html = html.slice(0,800000);
  const detections = [];
  function add(category, name, conf, evidence, version){
    // merge if same category+name (take highest confidence and merge evidence/version)
    const existing = detections.find(d=> d.category===category && d.name===name);
    if(existing){
      existing.confidence = Math.max(existing.confidence, conf);
      if(version && !existing.version) existing.version = version;
      existing.evidence.push(...evidence.slice(0,3));
    } else {
      detections.push({ category, name, confidence: Number(conf.toFixed(2)), evidence: evidence.slice(0,5), ...(version? { version }: {}) });
    }
  }
  const lower = html.toLowerCase();
  // CMS: Joomla
  const metaGenMatch = html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if(metaGenMatch){
    const gen = metaGenMatch[1];
    if(/joomla!/i.test(gen)){ add('CMS','Joomla',0.9,[gen]); }
    if(/wordpress/i.test(gen)){ add('CMS','WordPress',0.9,[gen]); }
  }
  // Joomla structural paths
  const jComp = [...new Set([...lower.matchAll(/\/components\/com_([a-z0-9_-]+)\//g)].map(m=>m[1]))].slice(0,30);
  jComp.forEach(c=> add('Joomla Component','com_'+c,0.7,[`/components/com_${c}/`]) );
  const jMod = [...new Set([...lower.matchAll(/\/modules\/mod_([a-z0-9_-]+)\//g)].map(m=>m[1]))].slice(0,30);
  jMod.forEach(c=> add('Joomla Module','mod_'+c,0.65,[`/modules/mod_${c}/`]));
  const jTpl = [...new Set([...lower.matchAll(/\/templates\/([a-z0-9_-]+)\//g)].map(m=>m[1]))].slice(0,20);
  jTpl.forEach(t=> add('Joomla Template', t,0.6,[`/templates/${t}/`]));
  // WordPress structural hints (even if plugins already separate)
  if(/\/wp-includes\//i.test(lower) || /\/wp-content\//i.test(lower)){ add('CMS','WordPress',0.85,['wp-content']); }
  // Libraries / Frameworks
  if(/mootools/i.test(lower)){ add('JavaScript Framework','MooTools',0.8,['mootools']); }
  if(/jquery\.migrate/i.test(lower)){ add('JavaScript Library','jQuery Migrate',0.8,['jquery-migrate']); }
  if(/jquery/i.test(lower)){ add('JavaScript Library','jQuery',0.75,['jquery']); }
  if(/bootstrap(?:\.min)?\.css/i.test(lower) || /data-bs-toggle=/.test(html)){ add('UI Framework','Bootstrap',0.8,['bootstrap.css or data-bs-toggle']); }
  if(/flexslider/i.test(lower)){ add('Widget','FlexSlider',0.75,['flexslider']); }
  // Analytics
  if(/www\.google-analytics\.com\/analytics\.js/i.test(lower) || /gtag\(/.test(html) || /googletagmanager\.com\/gtag\/js/i.test(lower)){ add('Analytics','Google Analytics',0.85,['ga/gtag']); }
  // Maps
  if(/maps\.googleapis\.com\/maps\/api\/js/i.test(lower)){ add('Map','Google Maps',0.85,['maps api']); }
  // Hosting panel
  const xPowered = headers?.get('x-powered-by') || '';
  if(/plesk/i.test(xPowered) || /plesk/i.test(html)){ add('Hosting Panel','Plesk',0.8,[xPowered||'plesk markup']); }
  // Server header
  const serverHeader = headers?.get('server') || '';
  if(/nginx/i.test(serverHeader)) add('Web Server','Nginx',0.9,[serverHeader]);
  else if(/apache/i.test(serverHeader)) add('Web Server','Apache',0.9,[serverHeader]);
  // PHP version from header
  if(/php\//i.test(xPowered)){
    const ver = (xPowered.match(/PHP\/([0-9.]+)/i)||[])[1];
    add('Language','PHP', ver?0.95:0.8,[xPowered], ver);
  }
  // Deep mode: try /administrator/ page (Joomla) for more evidence
  if(deep==='1'){
    try {
      const adminUrl = `https://${target}/administrator/`;
      const r = await timedFetch(adminUrl,{ timeout:5000 });
      if(r.status===200){
        const txt = (await r.text()).slice(0,120000).toLowerCase();
        if(/joomla/i.test(txt)){ add('CMS','Joomla',0.92,['administrator/ page']); }
      } else if([301,302,401,403].includes(r.status)){
        // redirect or protected — still a possible hint
        add('Path','/administrator/ present',0.4,[String(r.status)]);
      }
    } catch {}
  }
  // Normalize confidences (keep within 0-0.99) already ensured
  const payload = { ok:true, target, url: finalUrl, status, detections, fetchedAt: Date.now() };
  fpCache.set(cacheKey,{ expires: Date.now()+FP_TTL, data: payload });
  record('fingerprint_scan', req.user.id, { t: target, count: detections.length });
  res.json(payload);
});

app.get('/api/techniques', (req, res) => {
  // Determine if requester admin (optional auth header)
  let isAdmin = false;
  const header = req.headers.authorization;
  if(header){ try { const payload = jwt.verify(header.replace('Bearer ',''), JWT_SECRET); isAdmin = payload.role==='admin'; } catch {} }
  const all = req.query.all==='1' && isAdmin;
  const list = Techniques.all(all);
  res.json({ techniques: list });
});

// Create new technique (admin)
app.post('/api/techniques', authMiddleware, adminMiddleware, (req,res)=>{
  const { category, name, description, template } = req.body;
  if(!category || !name) return res.status(400).json({ error:'category & name required'});
  const clean = (s,max=2000)=> String(s||'').toString().slice(0,max);
  if(name.length>120) return res.status(400).json({ error:'name too long'});
  if(category.length>80) return res.status(400).json({ error:'category too long'});
  const t = Techniques.create({ category: clean(category,80), name: clean(name,120), description: clean(description,4000), template: clean(template,20000), status:'published' });
  metrics.techniqueCreates++; record('technique_create', req.user.id, { id: t.id });
  res.json({ technique: t });
});

// Update technique (admin)
app.put('/api/techniques/:id', authMiddleware, adminMiddleware, (req,res)=>{
  const { id } = req.params; const t = Techniques.find(id);
  if(!t) return res.status(404).json({ error:'Not found'});
  const { category, name, description, template } = req.body;
  const clean = (s,max=2000)=> String(s||'').toString().slice(0,max);
  const change = {};
  if(category!==undefined){ if(category.length>80) return res.status(400).json({ error:'category too long'}); change.category = clean(category,80); }
  if(name!==undefined){ if(name.length>120) return res.status(400).json({ error:'name too long'}); change.name = clean(name,120); }
  if(description!==undefined) change.description = clean(description,4000);
  if(template!==undefined) change.template = clean(template,20000);
  const updated = Techniques.update(id, change);
  metrics.techniqueUpdates++; record('technique_update', req.user.id, { id });
  res.json({ technique: updated });
});

// Delete technique (admin)
app.delete('/api/techniques/:id', authMiddleware, adminMiddleware, (req,res)=>{
  const { id } = req.params; const t = Techniques.find(id);
  if(!t) return res.status(404).json({ error:'Not found'});
  Techniques.delete(id);
  metrics.techniqueDeletes++; record('technique_delete', req.user.id, { id });
  res.json({ ok:true });
});

// Technique versions (admin)
app.get('/api/techniques/:id/versions', authMiddleware, adminMiddleware, (req,res)=>{
  const t = Techniques.find(req.params.id);
  if(!t) return res.status(404).json({ error:'Not found'});
  res.json({ versions: Techniques.versions(t.id) });
});

// Revert technique to a previous version snapshot (admin)
app.post('/api/techniques/:id/revert', authMiddleware, adminMiddleware, (req,res)=>{
  const { id } = req.params; const { index } = req.body;
  const t = Techniques.find(id);
  if(!t) return res.status(404).json({ error:'Not found'});
  const reverted = Techniques.revert(id, index);
  if(!reverted) return res.status(400).json({ error:'invalid version index'});
  record('technique_revert', req.user.id, { id, to:index });
  res.json({ technique: reverted });
});

// Technique status moderation (publish/archive/draft)
app.patch('/api/techniques/:id/status', authMiddleware, adminMiddleware, (req,res)=>{
  const { status } = req.body; if(!['published','draft','archived'].includes(status)) return res.status(400).json({ error:'invalid status'});
  const updated = Techniques.setStatus(req.params.id, status);
  if(!updated) return res.status(404).json({ error:'Not found'});
  record('technique_status', req.user.id, { id: updated.id, status });
  res.json({ technique: updated });
});

// User management (admin)
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req,res)=>{
  res.json({ users: Users.all() });
});
app.put('/api/admin/users/:id/role', authMiddleware, adminMiddleware, (req,res)=>{
  const { id } = req.params; const { role } = req.body;
  if(!['admin','user'].includes(role)) return res.status(400).json({ error:'invalid role'});
  const user = Users.findById(id);
  if(!user) return res.status(404).json({ error:'not found'});
  Users.updateRole(id, role);
  record('role_change', req.user.id, { target: id, role });
  const updated = Users.findById(id);
  res.json({ id:updated.id, email:updated.email, role:updated.role });
});

// (Optional) Admin password reset stub – just respond (placeholder for future secure implementation)
app.post('/api/admin/users/:id/reset-password', authMiddleware, adminMiddleware, (req,res)=>{
  const user = Users.findById(req.params.id);
  if(!user) return res.status(404).json({ error:'not found'});
  record('password_reset_stub', req.user.id, { target:user.id });
  res.json({ ok:true, message:'Password reset stub not implemented.' });
});

// Metrics & activity endpoint
app.get('/api/metrics', authMiddleware, (req,res)=>{
  const now = Date.now();
  const H24 = now - 24*60*60*1000;
  const last24 = Activity.since(H24);
  const byType24 = {}; last24.forEach(a=>{ byType24[a.type] = (byType24[a.type]||0)+1; });
  const hourMs = 60*60*1000; const series=[];
  for(let i=11;i>=0;i--){
    const start = now - i*hourMs; const bucketStart = start - (start % hourMs); const bucketEnd = bucketStart + hourMs;
    const count = last24.filter(a=> a.ts>=bucketStart && a.ts<bucketEnd).length;
    series.push({ hour: new Date(bucketStart).getHours(), count });
  }
  const isAdmin = req.user.role==='admin';
  const recent = isAdmin? Activity.recent(50) : Activity.recent(200).filter(r=> r.user_id===req.user.id).slice(0,50);
  const mapUser = (id)=>{ if(!id) return 'system'; const u = Users.findById(id); return u? u.email : 'unknown'; };
  res.json({
    users: Users.all().length,
    techniques: Techniques.all(false).length,
    techniques_all: isAdmin? Techniques.all(true).length: undefined,
    metrics,
    last24: byType24,
    series,
    recent: recent.map(r=>({ ts:r.ts, type:r.type, user: mapUser(r.user_id), meta: r.meta? JSON.parse(r.meta):{} }))
  });
});

// System settings (admin)
app.get('/api/admin/system', authMiddleware, adminMiddleware, (req,res)=>{
  res.json({ hibp: { perMinute: HIBP_MAX_PER_MINUTE, batchLimit: HIBP_MAX_BATCH }, cache: { cveSize: cveCache.size }, versions: { node: process.version }, uptime: process.uptime() });
});

// Assessments health check
app.get('/api/assess/health', (req,res)=> res.json({ ok:true }));

// Terminal WS (authenticated)
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/terminal' });

function verifyToken(token){
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const token = params.get('token');
  const payload = verifyToken(token || '');
  if (!payload) { ws.close(1008, 'unauthorized'); return; }
  const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
  const shellArgs = process.platform === 'win32' ? ['-NoLogo','-NoProfile'] : [];
  const term = spawn(shell, shellArgs, { stdio: 'pipe' });
  const id = uuidv4();
  ws.send(JSON.stringify({ type: 'init', id }));
  metrics.terminalSessions++; record('terminal_open', payload.sub);
  // Banner suppression (PowerShell often prints banner even with -NoLogo in some environments)
  let bannerSeen = false;
  const bannerRegex = /Windows PowerShell[\s\S]*?https:\/\/aka\.ms\/PSWindows\r?\n\r?\n?/i;
  function processChunk(buf){
    let text = buf.toString();
    if(!bannerSeen){
      const match = text.match(bannerRegex);
      if(match){
        bannerSeen = true; // Keep first banner as-is (optional). If you want to drop first too, set text = text.replace(bannerRegex,'');
        // For subsequent chunks bannerSeen true ensures removal.
      }
    } else {
      // Remove any subsequent banners entirely
      text = text.replace(bannerRegex,'');
    }
    if(text.length){ ws.send(JSON.stringify({ type:'data', data: text })); }
  }
  term.stdout.on('data', processChunk);
  term.stderr.on('data', processChunk);
  term.on('close', code => ws.send(JSON.stringify({ type: 'exit', code })));
  ws.on('message', msg => {
    try { const parsed = JSON.parse(msg); if (parsed.type==='stdin'){ term.stdin.write(parsed.data); if(parsed.data && /\S/.test(parsed.data.replace(/\r|\n/g,''))){ metrics.terminalCommands++; record('terminal_cmd', payload.sub); } } } catch {}
  });
  ws.on('close', () => term.kill());
});

// No automatic server.listen here; start.js is responsible for binding the port.

// --- Global diagnostics (helps when process mysteriously exits) ---
process.on('uncaughtException', (err)=>{
  console.error('[FATAL] uncaughtException', err.stack||err.message);
});
process.on('unhandledRejection', (reason)=>{
  console.error('[FATAL] unhandledRejection', reason);
});
let heartbeatCount=0;
setInterval(()=>{
  heartbeatCount++;
  if(heartbeatCount % 20 === 0){
  console.log('[HB] alive uptime='+process.uptime().toFixed(0)+'s scansQueued='+ (typeof scanService!=='undefined' && scanService.queueDepth? scanService.queueDepth():'?'));
  }
}, 3000).unref();

// Final 404 handler (after all routes)
app.use((req,res)=>{ if(!res.headersSent){ console.warn('404', req.method, req.path); res.status(404).json({ error:'not found', path:req.path }); } });

export { app, server };
