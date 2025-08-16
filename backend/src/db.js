import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// --- DB Isolation Core ---
// We keep a mutable exported binding `db` so tests can swap the active in-memory database
// without reloading every dependent module. All DAO helpers reference the live `db` variable
// at call time (not capturing it at definition) so reassignment is safe.
let dbFile = process.env.DB_FILE || (process.env.NODE_ENV==='test' ? ':memory:' : 'data.db');
let db = new Database(dbFile);
db.pragma('journal_mode = WAL');

function applySchema(target){
  target.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    login_count INTEGER NOT NULL DEFAULT 0
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS techniques (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    template TEXT,
    status TEXT NOT NULL DEFAULT 'published',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS technique_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    technique_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    category TEXT,
    name TEXT,
    description TEXT,
    template TEXT,
    FOREIGN KEY(technique_id) REFERENCES techniques(id) ON DELETE CASCADE
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    user_id TEXT,
    meta TEXT
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    target TEXT NOT NULL,
    type TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    raw_output TEXT,
    summary_json TEXT,
    score REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS scan_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    text TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 0,
    applied INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    ts INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS ai_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    instruction TEXT NOT NULL,
    plan_json TEXT,
    result_json TEXT,
    error TEXT
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS ai_settings (
    id INTEGER PRIMARY KEY CHECK (id=1),
    goal TEXT,
    tone TEXT,
    guardrails TEXT,
    updated_at INTEGER NOT NULL
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS scan_enrichment (
    scan_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE
  );`);
  target.exec(`CREATE TABLE IF NOT EXISTS validation_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id TEXT NOT NULL,
    finding_id TEXT NOT NULL,
    validated INTEGER NOT NULL,
    severity TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE
  );`);
  // Persistent agent events (lightweight audit of agent activity / errors)
  target.exec(`CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    task_id TEXT,
    agent TEXT,
    tool TEXT,
    data TEXT
  );`);
  // Schema migrations tracking (Sprint A)
  target.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );`);
  const aiSettingsExists = target.prepare('SELECT 1 FROM ai_settings WHERE id=1').get();
  if(!aiSettingsExists){
    target.prepare('INSERT INTO ai_settings (id,goal,tone,guardrails,updated_at) VALUES (1,?,?,?,?)')
      .run('Increase actionable security insight velocity for users while minimizing false positives.', 'Concise, professional, proactive, evidence-driven.', 'Never fabricate scan data. Only queue nmap or nuclei scans. Decline any request unrelated to application security scanning.', Date.now());
  }
}

applySchema(db);

// Swap active DB (tests)
export function isolateTestDb(label){
  if(process.env.NODE_ENV !== 'test') return db; // only isolate in test env
  const newDb = new Database(':memory:');
  newDb.pragma('journal_mode = WAL');
  applySchema(newDb);
  db = newDb; // reassign live binding
  if(label) try { console.log('[test-db] isolated DB instance', label); } catch {}
  return db;
}

export { db }; // live binding

export function seedAdmin(bcrypt){
  const exists = db.prepare('SELECT 1 FROM users WHERE email=?').get('admin@example.com');
  if(!exists){
    db.prepare('INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
      .run(randomUUID(),'admin@example.com', bcrypt.hashSync('password',10),'admin', new Date().toISOString());
    try { console.log('Seeded default admin (SQLite): admin@example.com / password'); } catch{}
  }
}

export const Users = {
  findByEmail(email){ return db.prepare('SELECT * FROM users WHERE email=?').get(email); },
  findById(id){ return db.prepare('SELECT * FROM users WHERE id=?').get(id); },
  create({ email, password_hash, role='user' }){ const id = randomUUID(); const now = new Date().toISOString(); db.prepare('INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)').run(id,email,password_hash,role,now); return Users.findById(id); },
  incrementLogin(id){ db.prepare('UPDATE users SET login_count = login_count + 1 WHERE id=?').run(id); },
  all(){ return db.prepare('SELECT id,email,role,created_at,login_count FROM users ORDER BY created_at DESC').all(); },
  updateRole(id, role){ db.prepare('UPDATE users SET role=? WHERE id=?').run(role,id); }
};

export const Techniques = {
  all(includeAll=false){ return includeAll? db.prepare('SELECT * FROM techniques ORDER BY updated_at DESC').all() : db.prepare("SELECT * FROM techniques WHERE status='published' ORDER BY updated_at DESC").all(); },
  find(id){ return db.prepare('SELECT * FROM techniques WHERE id=?').get(id); },
  create({ category,name,description,template,status='published' }){ const id = (name.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + Date.now().toString(36)); const now = new Date().toISOString(); db.prepare('INSERT INTO techniques (id,category,name,description,template,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,category,name,description,template,status,now,now); return Techniques.find(id); },
  update(id, changes){ const t = Techniques.find(id); if(!t) return null; const snapshot = { category:t.category, name:t.name, description:t.description, template:t.template }; db.prepare('INSERT INTO technique_versions (technique_id, ts, category, name, description, template) VALUES (?,?,?,?,?,?)').run(id, Date.now(), snapshot.category, snapshot.name, snapshot.description, snapshot.template); const newVals = { ...t, ...changes, updated_at: new Date().toISOString() }; db.prepare('UPDATE techniques SET category=?, name=?, description=?, template=?, status=?, updated_at=? WHERE id=?').run(newVals.category,newVals.name,newVals.description,newVals.template,newVals.status,newVals.updated_at,id); return Techniques.find(id); },
  delete(id){ db.prepare('DELETE FROM techniques WHERE id=?').run(id); },
  versions(id){ return db.prepare('SELECT * FROM technique_versions WHERE technique_id=? ORDER BY id ASC').all(id); },
  revert(id, index){ const versions = Techniques.versions(id); if(index <0 || index>=versions.length) return null; const v = versions[index]; return Techniques.update(id, { category:v.category, name:v.name, description:v.description, template:v.template }); },
  setStatus(id,status){ const t=Techniques.find(id); if(!t) return null; db.prepare('UPDATE techniques SET status=?, updated_at=? WHERE id=?').run(status,new Date().toISOString(),id); return Techniques.find(id); }
};

export const Activity = {
  record(type, userId, meta={}){ db.prepare('INSERT INTO activity (ts,type,user_id,meta) VALUES (?,?,?,?)').run(Date.now(), type, userId||null, JSON.stringify(meta)); },
  recent(limit=50){ return db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').all(limit); },
  since(ts){ return db.prepare('SELECT * FROM activity WHERE ts>=? ORDER BY id ASC').all(ts); }
};

export const Scans = {
  create({ id, user_id, target, type, command }){
    const now = Date.now();
    db.prepare('INSERT INTO scans (id,user_id,target,type,command,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id,user_id||null,target,type,command,'queued',now,now);
    return Scans.get(id);
  },
  markRunning(id){ db.prepare("UPDATE scans SET status='running', started_at=?, updated_at=? WHERE id=?").run(Date.now(), Date.now(), id); },
  complete(id, raw, summary, score){ db.prepare("UPDATE scans SET status='completed', completed_at=?, raw_output=?, summary_json=?, score=?, updated_at=? WHERE id=?").run(Date.now(), raw, JSON.stringify(summary||{}), score||0, Date.now(), id); },
  fail(id, message){ db.prepare("UPDATE scans SET status='failed', completed_at=?, raw_output=?, updated_at=? WHERE id=?").run(Date.now(), message.slice(0,4000), Date.now(), id); },
  list(limit=100){ return db.prepare('SELECT id,target,type,status,started_at,completed_at,score,created_at,updated_at FROM scans ORDER BY created_at DESC LIMIT ?').all(limit); },
  get(id){ return db.prepare('SELECT * FROM scans WHERE id=?').get(id); },
  latestForTarget(target){ return db.prepare('SELECT * FROM scans WHERE target=? ORDER BY created_at DESC LIMIT 20').all(target); },
  allWithoutSummary(){ return db.prepare("SELECT * FROM scans WHERE status='completed' AND (summary_json IS NULL OR summary_json='')").all(); }
  ,countRecentForTarget(target, since){ return db.prepare('SELECT COUNT(*) as c FROM scans WHERE target=? AND created_at>=?').get(target, since).c; }
};

export const ScanRecs = {
  add(scan_id, text, weight=0){ db.prepare('INSERT INTO scan_recommendations (scan_id, created_at, text, weight) VALUES (?,?,?,?)').run(scan_id, Date.now(), text, weight); },
  listForScan(scan_id){ return db.prepare('SELECT * FROM scan_recommendations WHERE scan_id=? ORDER BY weight DESC, id ASC').all(scan_id); },
  markApplied(id){ db.prepare('UPDATE scan_recommendations SET applied=1 WHERE id=?').run(id); }
};

export const ScanEnrichment = {
  upsert(scan_id, data){
    if(!scan_id || !data) return;
    const json = JSON.stringify(data);
    try {
      db.prepare('INSERT INTO scan_enrichment (scan_id,data,created_at) VALUES (?,?,?) ON CONFLICT(scan_id) DO UPDATE SET data=excluded.data').run(scan_id, json, Date.now());
    } catch {/* ignore */}
  },
  get(scan_id){ return db.prepare('SELECT data FROM scan_enrichment WHERE scan_id=?').get(scan_id); }
};

export const ValidationResults = {
  record({ scan_id, finding_id, validated, severity }){
    if(!scan_id || !finding_id) return;
    db.prepare('INSERT INTO validation_results (scan_id,finding_id,validated,severity,created_at) VALUES (?,?,?,?,?)')
      .run(scan_id, finding_id, validated?1:0, severity||null, Date.now());
  },
  statsForTarget(target){
    // Join via scans to aggregate per target across latest nuclei scan context
    return db.prepare(`SELECT vr.validated, COUNT(*) as c FROM validation_results vr
      JOIN scans s ON s.id=vr.scan_id WHERE s.target=? GROUP BY vr.validated`).all(target);
  },
  recentForScan(scan_id){ return db.prepare('SELECT finding_id, validated, severity, created_at FROM validation_results WHERE scan_id=? ORDER BY id DESC LIMIT 100').all(scan_id); }
};

export const AgentEvents = {
  record(evt){
    try {
      db.prepare('INSERT INTO agent_events (ts,type,task_id,agent,tool,data) VALUES (?,?,?,?,?,?)')
        .run(Date.now(), evt.type, evt.taskId||evt.task_id||null, evt.agent||null, evt.tool||null, evt.data? JSON.stringify(evt.data).slice(0,4000): null);
    } catch {}
  },
  recent({ limit=50, type, since, taskId }={}){
    let sql = 'SELECT id,ts,type,task_id as taskId,agent,tool,data FROM agent_events WHERE 1=1';
    const params = [];
    if(type){ sql += ' AND type=?'; params.push(type); }
    if(taskId){ sql += ' AND task_id=?'; params.push(taskId); }
    if(since){ sql += ' AND ts>=?'; params.push(since); }
    sql += ' ORDER BY id DESC LIMIT ?'; params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map(r=> ({ ...r, data: r.data? safeParse(r.data): undefined })).reverse();
  }
};

function safeParse(s){ try { return JSON.parse(s); } catch { return undefined; } }

export const AIMessages = {
  add(user_id, role, content){ db.prepare('INSERT INTO ai_messages (user_id, ts, role, content) VALUES (?,?,?,?)').run(user_id||null, Date.now(), role, content.slice(0,8000)); },
  recent(user_id, limit=30){ return db.prepare('SELECT role, content, ts FROM ai_messages WHERE user_id=? ORDER BY id DESC LIMIT ?').all(user_id, limit).reverse(); },
  truncate(user_id, max=500){ const count = db.prepare('SELECT COUNT(*) as c FROM ai_messages WHERE user_id=?').get(user_id).c; if(count>max){ const toDel = count-max; db.prepare('DELETE FROM ai_messages WHERE user_id=? AND id IN (SELECT id FROM ai_messages WHERE user_id=? ORDER BY id ASC LIMIT ?)').run(user_id,user_id,toDel); } }
};

export const AITasks = {
  create({ id, user_id, instruction }){
    const now = Date.now();
    db.prepare('INSERT INTO ai_tasks (id,user_id,created_at,updated_at,status,instruction) VALUES (?,?,?,?,?,?)')
      .run(id,user_id,now,now,'queued',instruction.slice(0,4000));
    return AITasks.get(id);
  },
  get(id){ return db.prepare('SELECT * FROM ai_tasks WHERE id=?').get(id); },
  list(user_id, limit=50){ return db.prepare('SELECT id,created_at,updated_at,status,instruction FROM ai_tasks WHERE user_id=? ORDER BY created_at DESC LIMIT ?').all(user_id, limit); },
  setPlan(id, plan){ db.prepare("UPDATE ai_tasks SET plan_json=?, status='running', updated_at=? WHERE id=?").run(JSON.stringify(plan), Date.now(), id); },
  updatePlan(id, plan){ db.prepare('UPDATE ai_tasks SET plan_json=?, updated_at=? WHERE id=?').run(JSON.stringify(plan), Date.now(), id); },
  complete(id, result){ db.prepare("UPDATE ai_tasks SET status='completed', result_json=?, updated_at=? WHERE id=?").run(JSON.stringify(result||{}), Date.now(), id); },
  fail(id, error){ db.prepare("UPDATE ai_tasks SET status='failed', error=?, updated_at=? WHERE id=?").run(error.slice(0,1000), Date.now(), id); },
  queued(){ return db.prepare("SELECT * FROM ai_tasks WHERE status IN ('queued','running') ORDER BY created_at ASC").all(); }
};

export const AISettings = {
  get(){ return db.prepare('SELECT goal,tone,guardrails,updated_at FROM ai_settings WHERE id=1').get(); },
  update(patch){
    const current = AISettings.get();
    const next = {
      goal: patch.goal !== undefined ? patch.goal : current.goal,
      tone: patch.tone !== undefined ? patch.tone : current.tone,
      guardrails: patch.guardrails !== undefined ? patch.guardrails : current.guardrails
    };
    db.prepare('UPDATE ai_settings SET goal=?, tone=?, guardrails=?, updated_at=? WHERE id=1').run(next.goal, next.tone, next.guardrails, Date.now());
    return AISettings.get();
  }
};

export function resetAll(){
  db.exec('DELETE FROM activity; DELETE FROM technique_versions; DELETE FROM techniques; DELETE FROM users; DELETE FROM scans; DELETE FROM scan_recommendations; DELETE FROM ai_messages; DELETE FROM ai_tasks;');
}
