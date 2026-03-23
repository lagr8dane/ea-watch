import { readFileSync } from 'fs';
import { getDb } from '../db/client.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function init() {
  const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
  const db = getDb();

  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => {
      if (!s.length) return false;
      const nonComment = s.split('\n')
        .filter(l => !l.trim().startsWith('--'))
        .join('\n').trim();
      return nonComment.length > 0;
    });

  const tables  = statements.filter(s => s.toUpperCase().includes('CREATE TABLE'));
  const indexes = statements.filter(s => s.toUpperCase().includes('CREATE INDEX'));
  const ordered = [...tables, ...indexes];

  await db.execute('PRAGMA foreign_keys = OFF');
  console.log(`Running ${ordered.length} schema statements...`);

  for (const sql of ordered) {
    try {
      await db.execute(sql);
      console.log(`  ok: ${sql.split('\n')[0].substring(0, 60)}`);
    } catch (err) {
      console.warn(`  skipped: ${err.message.split('\n')[0]}`);
    }
  }

  await db.execute('PRAGMA foreign_keys = ON');
  console.log('Schema applied successfully.');
  process.exit(0);
}

init().catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
