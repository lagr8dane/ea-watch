#!/usr/bin/env node
// scripts/db-migrate-avatar.js
// Adds avatar_url column to owner_config table.
// Safe to run multiple times.
//
// Usage:
//   node --env-file=.env scripts/db-migrate-avatar.js

import { createClient } from '@libsql/client';

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  console.log('EA Watch — avatar migration');
  console.log(`Target: ${process.env.TURSO_DATABASE_URL}`);

  try {
    await db.execute(`ALTER TABLE owner_config ADD COLUMN avatar_url TEXT`);
    console.log('  ✓  avatar_url column added');
  } catch (err) {
    if (err.message.includes('duplicate column')) {
      console.log('  ✓  avatar_url already exists, skipping');
    } else {
      console.error('  ✗  Failed:', err.message);
      process.exit(1);
    }
  }

  console.log('Done.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
