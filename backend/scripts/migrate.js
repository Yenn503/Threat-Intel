import fs from 'fs';
import path from 'path';
import { db } from '../src/db.js';
const migrationsDir = path.resolve(process.cwd(), 'migrations');
if(!fs.existsSync(migrationsDir)){
  console.log('[migrate] migrations directory not found, nothing to do');
  process.exit(0);
}
const applied = new Set(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(r=> r.id));
const files = fs.readdirSync(migrationsDir).filter(f=> /\.sql$/i.test(f)).sort();
let ran = 0;
for(const file of files){
  const id = file.replace(/\.sql$/i,'');
  if(applied.has(id)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir,file),'utf8');
  try {
    db.exec('BEGIN');
    if(sql.trim()) db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?,?)').run(id, Date.now());
    db.exec('COMMIT');
    ran++;
    console.log('[migrate] applied', id);
  } catch(e){
    try { db.exec('ROLLBACK'); } catch{}
    console.error('[migrate] failed', id, e.message);
    process.exit(1);
  }
}
console.log('[migrate] complete. Applied new migrations:', ran);
