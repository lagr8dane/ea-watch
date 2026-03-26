#!/usr/bin/env node
// magic_login_tokens — one-time browser sign-in links (see api/magic-link.js).
// Usage: node --env-file=.env scripts/db-migrate-magic-login.js

import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  console.log('EA Watch — magic_login_tokens table');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS magic_login_tokens (
      token       TEXT PRIMARY KEY,
      device_id   TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_magic_login_expires ON magic_login_tokens(expires_at)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_magic_login_owner_created ON magic_login_tokens(owner_id, created_at)`
  );
  console.log('Done.');
  process.exit(0);
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
