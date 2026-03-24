-- EA Watch — Phase 1 schema
-- Run once against your Turso DB to initialise

-- Registered NFC devices
CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,         -- internal UUID
  uid           TEXT NOT NULL UNIQUE,     -- 7-byte hardware UID (hex string)
  device_code   TEXT NOT NULL UNIQUE,     -- URL param ?d= value
  owner_id      TEXT NOT NULL,            -- references owner_config.id
  active        INTEGER NOT NULL DEFAULT 1,  -- 0 = decommissioned
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes         TEXT                      -- optional label (e.g. "EA Watch v1")
);

-- Server-side sessions (HttpOnly cookie holds the token)
CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,         -- crypto random, 32 bytes hex
  device_id     TEXT NOT NULL REFERENCES devices(id),
  owner_id      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,            -- computed from owner config session_window
  is_shell      INTEGER NOT NULL DEFAULT 0  -- 1 = danger word session (shell EA)
);

-- Every tap logged, regardless of outcome
CREATE TABLE IF NOT EXISTS tap_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL,
  device_code   TEXT NOT NULL,
  outcome       TEXT NOT NULL,            -- 'ea_direct' | 'challenge' | 'stranger' | 'invalid'
  ip            TEXT,
  user_agent    TEXT,
  logged_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rate limiting + lockout tracking per device
CREATE TABLE IF NOT EXISTS auth_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     TEXT NOT NULL REFERENCES devices(id),
  attempted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  success       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_lockouts (
  device_id     TEXT PRIMARY KEY REFERENCES devices(id),
  locked_until  TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 5
);

-- Owner configuration (one row per owner)
CREATE TABLE IF NOT EXISTS owner_config (
  id                  TEXT PRIMARY KEY,   -- UUID
  -- Identity
  display_name        TEXT NOT NULL,
  title               TEXT,
  -- Credentials (bcrypt hashed)
  pin_hash            TEXT,
  access_word_hash    TEXT,
  danger_word_hash    TEXT,
  -- Session
  session_window_mins INTEGER NOT NULL DEFAULT 60,
  -- Challenge style: 'pin' | 'word' | 'word_then_pin'
  challenge_style     TEXT NOT NULL DEFAULT 'word_then_pin',
  -- Challenge phrasing (EA voice)
  challenge_phrase    TEXT NOT NULL DEFAULT 'Hey — it''s been a while. What''s the word?',
  -- EA personality (system prompt prefix)
  ea_personality      TEXT,
  -- Danger word alert
  alert_phone         TEXT,               -- iMessage target
  alert_email         TEXT,               -- email fallback
  -- Stranger card
  stranger_linkedin   TEXT,
  stranger_instagram  TEXT,
  stranger_calendly   TEXT,
  stranger_whatsapp   TEXT,
  stranger_imessage   TEXT,
  stranger_bio        TEXT,
  -- Meta
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for hot paths
CREATE INDEX IF NOT EXISTS idx_devices_uid_code ON devices(uid, device_code);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_tap_log_uid      ON tap_log(uid);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_device ON auth_attempts(device_id, attempted_at);
