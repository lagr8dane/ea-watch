# EA Watch — Session Handoff

Paste this file into a new Claude session to resume building.

---

## What this project is

A custom wristwatch with an NTAG213 anti-metal NFC chip in the case back. Anyone who taps the watch with their phone gets one of two experiences based on identity:

- **Owner** → Authenticated personal AI assistant (the EA). Voice and text. Chain automation.
- **Stranger** → Polished contact gateway. LinkedIn, book a meeting, iMessage/WhatsApp.

---

## Current state

**Phase 1 and Phase 2 are complete and running in production at `https://ea-watch.vercel.app`.**

All code is committed to GitHub at `lagr8dane/ea-watch`.

### What's built and working

**Phase 1 — Identity + Gateway**
- Turso DB (9 tables: devices, sessions, tap_log, auth_attempts, owner_config, chains, chain_steps, chain_state, action_log)
- Tap gateway — UID + device code dual validation, session state routing
- Auth endpoint — PIN/access word/danger word, rate limiting, 30-min server-side lockout
- Session management — HttpOnly cookies, active/warm/cold/unknown state machine, expiry enforced
- Danger word — shell mode + silent alert dispatcher (iMessage webhook + Resend email fallback)
- Stranger contact card — pulls from config, shows LinkedIn/Calendly/iMessage/WhatsApp. Edge-cached at Vercel (5-min TTL, stale-while-revalidate 10 min)
- Challenge UI — configurable style (pin / word / word_then_pin), EA voice delivery
- EA chat interface — streaming, Web Speech API voice input, shell mode aware
- EA streaming endpoint — Claude API (claude-sonnet-4-5), configurable system prompt, session gated
- Config app — all owner settings, credential hashing, stranger card fields
- NFC stub — `/stub` UI + `/api/dev/tap` endpoint, ENABLE_STUB gate
- Device registration endpoint
- Local dev server (`server.js`)

**Phase 2 — Chain Engine**
- Chain builder UI at `/chains` (called "Routines" in the UX)
- Chain CRUD API — `api/chains.js` — create, edit, reorder, delete chains and steps
- Chain execution engine — `lib/chain-engine.js` — step sequencer, state machine, graceful abort
- Step types: silent (auto-execute), confirmable (Continue/Skip buttons), required (Continue only), conditional (weather/time/calendar checks)
- OS delegation — deeplinks for Maps, calls, Spotify, timer, SMS, reminders; Siri Shortcuts for HealthKit, DND, HomeKit
- Conditional evaluators — Open-Meteo weather (free, no API key), time-of-day, calendar webhook
- Chain state — server-side in `chain_state` table, keyed to session token
- Action log — permanent audit trail in `action_log` table, viewable at `/action-log`
- Chain interrupt — "stop" mid-chain aborts remaining steps
- EA integration — trigger phrase matching, active chain state check, SSE result streaming
- Confirmable steps render Continue/Skip/Stop buttons in the EA chat UI
- Client fires deeplinks/Shortcuts via `window.location.href` with action pill display
- Shared navigation drawer — hamburger menu on all pages (EA, Routines, Log, Settings), inlined per page

### What's next — Phase 3
- Interaction logging with pattern analysis — tracks sequences across sessions
- Chain proposal surface — after 3 repetitions, EA proposes the chain conversationally
- Proactive context suggestions — time, location, calendar, weather as trigger signals
- One-tap chain approval — proposed chain shows steps for review before adding to library

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
- **Sessions PK is `token` (not `id`).** All session queries use `token` as the identifier. `chain_state.session_id` and `action_log.session_id` reference `sessions(token)`.
- **Auth library:** bcryptjs (not bcrypt — native binary fails on Vercel Linux).
- **Alert delivery:** iMessage via webhook primary, Resend email fallback.
- **Local dev:** `node --env-file=.env server.js` on port 3000.
- **DB client exports:** `query`, `queryOne`, `execute` — no `db` export. Never import `db` from `db/client.js`.
- **No `requireOwnerSession` helper.** Session validation is inline in each API handler — parse cookie, query sessions table, check expiry and is_shell.
- **Nav drawer is inlined** in each HTML page, not loaded from `nav.js`. The `nav.js` file exists but nav is duplicated inline to avoid script loading timing issues.

---

## File structure

```
api/
  tap.js                gateway handler
  auth.js               challenge-response + lockout
  ea.js                 Claude streaming endpoint + chain trigger/interrupt
  config.js             owner config read/write
  chains.js             chain CRUD — all /api/chains/* routes handled here
  chain-execute.js      chain execution control (continue/skip/abort) + action log reader
  device.js             device registration + transfer
  config/public.js      stranger-safe config endpoint (edge-cached)
  dev/tap.js            NFC stub (ENABLE_STUB gate)
public/
  contact.html          stranger card
  ea.html               EA chat UI (nav drawer inlined)
  challenge.html        auth challenge
  config.html           owner settings (nav drawer inlined)
  chain-builder.html    routines builder UI (nav drawer inlined)
  action-log.html       action log viewer (nav drawer inlined)
  stub.html             tap simulator
  nav.js                nav drawer (reference copy — actual nav is inlined per page)
lib/
  auth.js               tokens, bcryptjs, session state helpers
  audit.js              tap log writer
  ratelimit.js          lockout logic
  alert.js              danger word alert dispatcher
  chain-engine.js       core chain sequencer — public API: matchChain, getActiveChainState, startChain, resumeChain, abortActiveChain
  action-log.js         action log writer and reader
  actions/
    deeplinks.js        iOS/Android deeplink URL builders
    shortcuts.js        Siri Shortcuts x-callback-url builder
    conditional.js      weather/time/calendar conditional evaluators
db/
  schema.sql            Phase 1 schema (5 tables)
  schema-phase2.sql     Phase 2 schema reference (4 additional tables)
  client.js             Turso client — exports query, queryOne, execute
scripts/
  db-init.js            Phase 1 migration
  db-migrate-phase2.js  Phase 2 migration (chains, chain_steps, chain_state, action_log)
server.js               local dev server
vercel.json             routing — explicit rewrites + functions block
```

---

## DB schema summary

**Phase 1:** devices, sessions, tap_log, auth_attempts, owner_config

**Phase 2 additions:**
- `chains` — user-defined chains. FK: device_id → devices(id)
- `chain_steps` — ordered steps per chain. FK: chain_id → chains(id)
- `chain_state` — active/recent execution state. FK: session_id → sessions(token), chain_id → chains(id)
- `action_log` — permanent execution audit trail. FK: session_id → sessions(token)

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

## vercel.json routing notes

Vercel requires explicit rewrites for parameterised API routes since it only auto-routes `api/filename` exactly. Current rewrites cover:
- `/api/chains/:id`, `/api/chains/:id/steps`, `/api/chains/:id/steps/:stepId` → all rewrite to `/api/chains`
- `/api/chain-execute/log` → rewrites to `/api/chain-execute`
- Page routes: `/chains` → `chain-builder.html`, `/action-log` → `action-log.html`
- The `functions` block (`"api/**/*.js"`) is required for Vercel to detect serverless functions correctly

---

## Owner

Marco Rota. Technology executive, Reno NV.
Comfortable with code. Prefers to understand decisions, not just receive them.
Building for personal use first, potential productisation later.
GitHub: lagr8dane/ea-watch
