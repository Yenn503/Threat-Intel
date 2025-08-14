import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const dbFile = process.env.DB_FILE || (process.env.NODE_ENV==='test' ? ':memory:' : 'data.db');
export const db = new Database(dbFile);
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  login_count INTEGER NOT NULL DEFAULT 0
);`);

db.exec(`CREATE TABLE IF NOT EXISTS techniques (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  template TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`);

db.exec(`CREATE TABLE IF NOT EXISTS technique_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  technique_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  category TEXT,
  name TEXT,
  description TEXT,
  template TEXT,
  FOREIGN KEY(technique_id) REFERENCES techniques(id) ON DELETE CASCADE
);`);

db.exec(`CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  user_id TEXT,
  meta TEXT
);`);

export function seedAdmin(bcrypt){
  const exists = db.prepare('SELECT 1 FROM users WHERE email=?').get('admin@example.com');
  if(!exists){
    db.prepare('INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
      .run(randomUUID(),'admin@example.com', bcrypt.hashSync('password',10),'admin', new Date().toISOString());
    console.log('Seeded default admin (SQLite): admin@example.com / password');
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

export function resetAll(){
  db.exec('DELETE FROM activity; DELETE FROM technique_versions; DELETE FROM techniques; DELETE FROM users;');
}
