const db = require('better-sqlite3')('db/custom.db');
console.log('Tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
try {
  const rows = db.prepare("SELECT key, substr(value,1,300) as v FROM kv LIMIT 10").all();
  rows.forEach(r => console.log(r.key, ':', r.v));
} catch(e) { console.log('kv error:', e.message); }
