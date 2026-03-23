#!/usr/bin/env node
// scripts/db-migrate-phase2.js
// Applies the phase 2 schema additions to the Turso database.
// Safe to run multiple times — all statements use CREATE TABLE IF NOT EXISTS.
//
// Usage:
//   node --env-file=.env scripts/db-migrate-phase2.js

import { createClient } from '@libsql/client';

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ---------------------------------------------------------------------------
// Schema defined inline — avoids comment/semicolon parsing issues
// ---------------------------------------------------------------------------
const statements = [
  // chains
  `CREATE TABLE IF NOT EXISTS chains (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    device_id      TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    trigger_phrase TEXT NOT NULL,
    description    TEXT,
    enabled        INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chains_device_id ON chains(device_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chains_trigger ON chains(device_id, trigger_phrase)`,

  // chain_steps
  `CREATE TABLE IF NOT EXISTS chain_steps (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    chain_id      TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    step_type     TEXT NOT NULL CHECK (step_type IN ('silent', 'confirmable', 'required', 'conditional')),
    action_type   TEXT NOT NULL,
    action_config TEXT NOT NULL DEFAULT '{}',
    prompt_text   TEXT,
    skip_on_fail  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chain_steps_chain_id ON chain_steps(chain_id, position)`,

  // chain_state
  `CREATE TABLE IF NOT EXISTS chain_state (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    session_id    TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
    chain_id      TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
    current_step  INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'awaiting_confirm', 'completed', 'aborted', 'error')),
    context       TEXT NOT NULL DEFAULT '{}',
    steps_run     TEXT NOT NULL DEFAULT '[]',
    steps_skipped TEXT NOT NULL DEFAULT '[]',
    abort_reason  TEXT,
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chain_state_session ON chain_state(session_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_chain_state_started_at ON chain_state(started_at)`,

  // action_log
  `CREATE TABLE IF NOT EXISTS action_log (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    session_id      TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
    chain_state_id  TEXT REFERENCES chain_state(id) ON DELETE SET NULL,
    action_type     TEXT NOT NULL,
    action_config   TEXT NOT NULL DEFAULT '{}',
    outcome         TEXT NOT NULL CHECK (outcome IN ('success', 'skipped', 'failed', 'aborted')),
    error_detail    TEXT,
    executed_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_action_log_session ON action_log(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_action_log_executed_at ON action_log(executed_at)`,
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function migrate() {
  console.log('EA Watch — Phase 2 DB migration');
  console.log(`Target: ${process.env.TURSO_DATABASE_URL}`);
  console.log(`Statements: ${statements.length}`);
  console.log('');

  let passed = 0;
  let failed = 0;

  for (const sql of statements) {
    const label = sql.trim().split('\n')[0].slice(0, 72);
    try {
      await db.execute(sql);
      console.log(`  ✓  ${label}`);
      passed++;
    } catch (err) {
      console.error(`  ✗  ${label}`);
      console.error(`     ${err.message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`Migration complete. ${passed} passed, ${failed} failed.`);

  if (failed > 0) {
    console.error('Review errors above before proceeding.');
    process.exit(1);
  }

  // Verify
  console.log('');
  console.log('Verifying tables...');
  for (const table of ['chains', 'chain_steps', 'chain_state', 'action_log']) {
    const result = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
    );
    if (result.rows.length > 0) {
      console.log(`  ✓  ${table}`);
    } else {
      console.error(`  ✗  ${table} not found`);
      process.exit(1);
    }
  }

  console.log('');
  console.log('Phase 2 schema ready.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
