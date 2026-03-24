-- Owner tasks (first-party todos). Applied via scripts/db-migrate-tasks.js

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES owner_config(id),
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open'
             CHECK (status IN ('open', 'complete', 'deleted')),
  priority   TEXT NOT NULL DEFAULT 'normal'
             CHECK (priority IN ('low', 'normal', 'high')),
  due_at     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner_status ON tasks(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_due ON tasks(owner_id, due_at);
