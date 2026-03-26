#!/usr/bin/env node
// Creates pending_commands for cross-device continuation (one row per owner).
// Usage: node --env-file=.env scripts/db-migrate-pending-command.js

import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  console.log('EA Watch — pending_commands table');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pending_commands (
      owner_id        TEXT PRIMARY KEY,
      payload         TEXT NOT NULL,
      target_surface  TEXT NOT NULL DEFAULT 'phone',
      version         INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at      TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_pending_commands_expires ON pending_commands(expires_at)`
  );
  console.log('Done.');
  process.exit(0);
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
