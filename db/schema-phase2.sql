-- EA Watch — Phase 2 Schema Migration
-- Additive only. Does not touch phase 1 tables.
-- Run via: node --env-file=.env scripts/db-migrate-phase2.js

-- ---------------------------------------------------------------------------
-- chains
-- One row per user-defined chain. Trigger phrase is what the EA listens for.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chains (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                -- display name, e.g. "Start my hike"
  trigger_phrase TEXT NOT NULL,              -- what the EA matches on, e.g. "start my hike"
  description   TEXT,                        -- optional owner note
  enabled       INTEGER NOT NULL DEFAULT 1,  -- 0 = disabled, 1 = active
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chains_device_id ON chains(device_id);
CREATE INDEX IF NOT EXISTS idx_chains_trigger   ON chains(device_id, trigger_phrase);

-- ---------------------------------------------------------------------------
-- chain_steps
-- Ordered steps within a chain. position is 0-indexed.
-- action_type drives which action handler runs.
-- action_config is a JSON blob — schema varies by action_type (see lib/actions/).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chain_steps (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  chain_id      TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,            -- 0-indexed execution order
  step_type     TEXT NOT NULL CHECK (step_type IN ('silent', 'confirmable', 'required', 'conditional')),
  action_type   TEXT NOT NULL,               -- e.g. 'deeplink', 'shortcut', 'weather_check', 'time_check', 'calendar_check', 'message'
  action_config TEXT NOT NULL DEFAULT '{}',  -- JSON — see action type docs in lib/actions/
  prompt_text   TEXT,                        -- for confirmable/required: what the EA says to the user
  skip_on_fail  INTEGER NOT NULL DEFAULT 0,  -- 1 = skip step silently if action errors; 0 = abort chain
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chain_steps_chain_id ON chain_steps(chain_id, position);

-- ---------------------------------------------------------------------------
-- chain_state
-- Active and recent chain executions. One row per in-progress or completed run.
-- Keyed to session_id so the EA can resume mid-chain across message turns.
-- context holds runtime data accumulated during execution (e.g. user answers,
-- conditional outcomes) — used when confirmable steps need to recall prior state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chain_state (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  session_id    TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
  chain_id      TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
  current_step  INTEGER NOT NULL DEFAULT 0,  -- index of next step to execute
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'awaiting_confirm', 'completed', 'aborted', 'error')),
  context       TEXT NOT NULL DEFAULT '{}',  -- JSON — runtime state accumulated during execution
  steps_run     TEXT NOT NULL DEFAULT '[]',  -- JSON array — log of completed step ids
  steps_skipped TEXT NOT NULL DEFAULT '[]',  -- JSON array — log of skipped step ids
  abort_reason  TEXT,                        -- set on aborted/error, human-readable
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chain_state_session    ON chain_state(session_id, status);
CREATE INDEX IF NOT EXISTS idx_chain_state_started_at ON chain_state(started_at);

-- ---------------------------------------------------------------------------
-- action_log
-- Permanent record of every action and chain execution.
-- Separate from chain_state — state is ephemeral, log is the audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS action_log (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  session_id    TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
  chain_state_id TEXT REFERENCES chain_state(id) ON DELETE SET NULL, -- null for standalone atomic actions
  action_type   TEXT NOT NULL,
  action_config TEXT NOT NULL DEFAULT '{}',  -- JSON snapshot of what was executed
  outcome       TEXT NOT NULL CHECK (outcome IN ('success', 'skipped', 'failed', 'aborted')),
  error_detail  TEXT,
  executed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_action_log_session    ON action_log(session_id);
CREATE INDEX IF NOT EXISTS idx_action_log_executed_at ON action_log(executed_at);
