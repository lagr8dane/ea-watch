#!/usr/bin/env node
// Adds Spotify OAuth token columns to owner_config.
// Usage: node --env-file=.env scripts/db-migrate-spotify.js

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
  console.log('EA Watch — Spotify OAuth columns migration');
  await addColumn(
    `ALTER TABLE owner_config ADD COLUMN spotify_refresh_token TEXT`,
    'spotify_refresh_token'
  );
  await addColumn(
    `ALTER TABLE owner_config ADD COLUMN spotify_access_token TEXT`,
    'spotify_access_token'
  );
  await addColumn(
    `ALTER TABLE owner_config ADD COLUMN spotify_token_expires_at INTEGER`,
    'spotify_token_expires_at'
  );
  console.log('Done.');
  process.exit(0);
}

migrate().catch(() => process.exit(1));
