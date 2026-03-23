import { readFileSync } from 'fs';
import { getDb } from '../db/client.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function init() {
  const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
  const db = getDb();

  // Split on semicolons, filter blanks, execute each statement
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`Running ${statements.length} schema statements...`);

  for (const sql of statements) {
    await db.execute(sql);
  }

  console.log('Schema applied successfully.');
  process.exit(0);
}

init().catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
