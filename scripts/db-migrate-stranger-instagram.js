#!/usr/bin/env node
// Adds stranger_instagram for tap-to-meet / public card.
// Usage: node --env-file=.env scripts/db-migrate-stranger-instagram.js

import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function addColumn(sql, name) {
  try {
    await db.execute(sql);
    console.log(`  ✓  ${name} added`);
  } catch (err) {
    if (String(err.message).includes('duplicate column')) {
      console.log(`  ✓  ${name} already exists`);
    } else {
      console.error(`  ✗  ${name}:`, err.message);
      throw err;
    }
  }
}

async function migrate() {
  console.log('EA Watch — stranger_instagram migration');
  await addColumn(
    `ALTER TABLE owner_config ADD COLUMN stranger_instagram TEXT`,
    'stranger_instagram'
  );
  console.log('Done.');
  process.exit(0);
}

migrate().catch(() => process.exit(1));
