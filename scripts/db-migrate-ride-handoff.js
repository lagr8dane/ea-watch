#!/usr/bin/env node
// Adds interest_radar_ride_handoff to owner_config (uber | google_maps | apple_maps).
// Usage: node --env-file=.env scripts/db-migrate-ride-handoff.js

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
  console.log('EA Watch — interest radar ride handoff migration');
  await addColumn(
    `ALTER TABLE owner_config ADD COLUMN interest_radar_ride_handoff TEXT`,
    'interest_radar_ride_handoff'
  );
  console.log('Done.');
  process.exit(0);
}

migrate().catch(() => process.exit(1));
