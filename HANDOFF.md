# EA Watch — Session Handoff

Paste this file into a new Claude session to resume building.

---

## What this project is

A custom wristwatch with an NTAG213 anti-metal NFC chip in the case back. Anyone who taps the watch with their phone gets one of two experiences based on identity:

- **Owner** → Authenticated personal AI assistant (the EA). Voice and text. Chain automation.
- **Stranger** → Polished contact gateway. LinkedIn, book a meeting, iMessage/WhatsApp.

---

## Current state

**Phase 1 is complete and running in production at `https://ea-watch.vercel.app`.**

All code is committed to GitHub at `lagr8dane/ea-watch`.

### What's built and working
- Turso DB (5 tables: devices, sessions, tap_log, auth_attempts, owner_config)
- Tap gateway — UID + device code dual validation, session state routing
- Auth endpoint — PIN/access word/danger word, rate limiting, 30-min server-side lockout
- Session management — HttpOnly cookies, active/warm/cold/unknown state machine, expiry enforced
- Danger word — shell mode + silent alert dispatcher (iMessage webhook + Resend email fallback)
- Stranger contact card — pulls from config, shows LinkedIn/Calendly/iMessage/WhatsApp
- Challenge UI — configurable style (pin / word / word_then_pin), EA voice delivery
- EA chat interface — streaming, Web Speech API voice input, shell mode aware
- EA streaming endpoint — Claude API (claude-sonnet-4-5), configurable system prompt, session gated
- Config app — all owner settings, credential hashing, stranger card fields
- NFC stub — `/stub` UI + `/api/dev/tap` endpoint, ENABLE_STUB gate
- Device registration endpoint
- Local dev server (`server.js`)
- Security review passed
- Production smoke test passed

### What's next — Phase 2
- Chain builder in config app — name a chain, add ordered steps, type each as silent/confirmable/required
- Chain execution engine — sequential steps, confirmable steps handled conversationally, graceful abort
- OS delegation layer — Siri Shortcuts, Maps, Spotify, HealthKit via deeplinks and APIs
- Conditional steps — weather, time, calendar state before executing
- Action log — every action and chain logged with timestamp
- Chain interrupt — "stop" mid-chain aborts remaining steps

---

## How to run locally

```bash
git clone https://github.com/lagr8dane/ea-watch.git
cd ea-watch
npm install
# Create .env from .env.example and fill in values
node --env-file=.env server.js
# Server at http://localhost:3000
```

**Do not use `vercel dev`** — use `node --env-file=.env server.js` instead.

---

## Key architecture decisions (do not revisit)

- **EA orchestrates, does not rebuild.** Atomic actions delegate to OS deeplinks/APIs.
- **Auth is deterministic infrastructure.** Claude API is the intelligence layer above it.
- **Security non-negotiables:** UID+code dual validation, HttpOnly cookies, server-side lockout.
- **Database:** Turso (SQLite edge). No Supabase, no Vercel KV.
- **Auth library:** bcryptjs (not bcrypt — native binary fails on Vercel Linux).
- **Alert delivery:** iMessage via webhook primary, Resend email fallback.
- **Local dev:** `node --env-file=.env server.js` on port 3000.

---

## File structure

```
api/
  tap.js              gateway handler
  auth.js             challenge-response + lockout
  ea.js               Claude streaming endpoint
  config.js           owner config read/write
  device.js           device registration + transfer
  config/public.js    stranger-safe config endpoint
  dev/tap.js          NFC stub (ENABLE_STUB gate)
public/
  contact.html        stranger card
  ea.html             EA chat UI
  challenge.html      auth challenge
  config.html         owner config app
  stub.html           tap simulator
lib/
  auth.js             tokens, bcryptjs, session state
  audit.js            tap log writer
  ratelimit.js        lockout logic
  alert.js            danger word alert dispatcher
db/
  schema.sql          5-table schema
  client.js           Turso client
scripts/
  db-init.js          schema migration
server.js             local dev server
```

---

## Environment variables

```
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
ANTHROPIC_API_KEY
RESEND_API_KEY
ALERT_FROM_EMAIL
ENABLE_STUB=true (local) / false (production)
APP_URL=http://localhost:3000 (local) / https://ea-watch.vercel.app (production)
NODE_ENV=development (local) / production (Vercel)
```

---

## Owner

Marco Rota. Technology executive, Reno NV.  
Comfortable with code. Prefers to understand decisions, not just receive them.  
Building for personal use first, potential productisation later.  
GitHub: lagr8dane/ea-watch
