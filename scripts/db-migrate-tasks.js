#!/usr/bin/env node
// Creates owner tasks table for EA capture / reminders.
// Usage: node --env-file=.env scripts/db-migrate-tasks.js

import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'complete', 'deleted')),
    priority   TEXT NOT NULL DEFAULT 'normal'
               CHECK (priority IN ('low', 'normal', 'high')),
    due_at     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES owner_config(id)
  )
`);

await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_owner_status ON tasks(owner_id, status)`);
await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_owner_due ON tasks(owner_id, due_at)`);

console.log('tasks table ready.');
process.exit(0);
