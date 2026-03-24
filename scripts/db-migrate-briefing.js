#!/usr/bin/env node
// scripts/db-migrate-briefing.js
// Adds last_briefing_date column to owner_config.
// Usage: node --env-file=.env scripts/db-migrate-briefing.js

import { createClient } from '@libsql/client';

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  console.log('EA Watch — briefing migration');
  try {
    await db.execute(`ALTER TABLE owner_config ADD COLUMN last_briefing_date TEXT`);
    console.log('  ✓  last_briefing_date added');
  } catch (err) {
    if (err.message.includes('duplicate column')) {
      console.log('  ✓  last_briefing_date already exists');
    } else {
      console.error('  ✗  Failed:', err.message);
      process.exit(1);
    }
  }
  console.log('Done.');
  process.exit(0);
}

migrate().catch(err => { console.error(err); process.exit(1); });
