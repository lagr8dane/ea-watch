# EA Watch — Session Handoff

Paste this file into a new Claude or Cursor session to resume building.

---

## What this project is

A custom wristwatch with an NTAG213 anti-metal NFC chip in the case back. Anyone who taps the watch with their phone gets one of two experiences based on identity:

- **Owner** → Authenticated personal AI assistant (the EA). Voice and text. Chain automation. Morning briefing.
- **Stranger** → Polished contact gateway. LinkedIn, book a meeting, iMessage/WhatsApp. Profile photo shown.

---

## Current state

**Phases 1, 2, and Phase 3 (partial) are running in production at `https://ea-watch.vercel.app`.**

All code is committed to GitHub at `lagr8dane/ea-watch`.

### What's built and working

**Phase 1 — Identity + Gateway**
- Turso DB (9 tables: devices, sessions, tap_log, auth_attempts, owner_config, chains, chain_steps, chain_state, action_log)
- Tap gateway — UID + device code dual validation, session state routing
- Auth — PIN/access word/danger word, rate limiting, 30-min server-side lockout
- Session management — HttpOnly cookies, active/warm/cold/unknown state machine
- Danger word — shell mode + silent alert (iMessage + Resend email fallback)
- Stranger contact card — LinkedIn/Calendly/iMessage/WhatsApp, profile photo, edge-cached (5-min TTL)
- Challenge UI — configurable style, EA voice delivery
- EA chat interface — streaming, Web Speech API voice input, shell mode aware
- Config app — all owner settings, credential hashing, stranger card fields, profile photo upload
- Profile photo upload — Vercel Blob, shown on contact card
- NFC stub — `/stub` UI + `/api/dev/tap`, ENABLE_STUB gate
- Shared navigation drawer — hamburger on all pages, inlined per page

**Phase 2 — Chain Engine**
- Chain builder UI at `/chains` (called "Routines" in UX)
- Chain CRUD API — `api/chains.js`
- Chain execution engine — `lib/chain-engine.js` — step sequencer, state machine, graceful abort
- Step types: silent, confirmable (Continue/Skip buttons), required, conditional
- OS delegation — deeplinks for Maps/calls/Spotify/timer/SMS; Siri Shortcuts for HealthKit/DND/HomeKit
- Conditional evaluators — Open-Meteo weather, time-of-day, calendar webhook
- Chain state — server-side in `chain_state` table, keyed to session token
- Action log — permanent audit trail, viewable at `/action-log`
- EA integration — trigger phrase matching, chain state check, SSE result streaming

**Phase 3 — Morning Briefing (partial)**
- `api/briefing.js` — standalone endpoint for weather (Open-Meteo, free) and news (NewsAPI)
- Weather briefing — works ("weather", "how's the weather" etc.)
- News briefing — works ("top news", "headlines" etc.)
- Quote/motivation — works ("morning quote", "inspire me" etc.)
- Morning briefing — three-part flow (weather + news + quote as separate bubbles)
- First-tap-of-day detection — auto-triggers morning briefing on first EA open each day
- EA avatar — small "EA" circle on every EA message bubble
- Personalised greeting — "Good morning, Marco! How can I help?"
- No-markdown enforcement — FORMATTING_RULES appended to every system prompt

---

## Known bugs — fix these first

### 1. EA page hangs on load (CRITICAL)

`public/ea.html` load event listener is declared `async` and `await`s `loadOwnerName()`. If that fetch is slow, the page hangs before the greeting appears.

**Fix:**
```js
window.addEventListener('load', () => {
  requestLocation();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const el = appendMsg('ea', `${greet}! How can I help?`);
  loadOwnerName().then(() => {
    if (ownerFirstName && el) el.textContent = `${greet}, ${ownerFirstName}! How can I help?`;
  }).catch(() => {});
});
```

### 2. Morning briefing three-part flow is fragile

When user says "morning briefing", `ea.js` sends `{ morning_briefing: true }` over SSE. The client fires three sequential requests via `sendBriefingPart()`. This works when each part responds quickly but can hang if any part is slow.

**DO NOT attempt to render structured card data from SSE events.** Every attempt to send JSON card payloads over SSE and render them as HTML cards failed due to chunk-splitting. Text bubbles only.

### 3. Dead card code in ea.html

`ea.html` still contains dead functions (`appendWeatherCard`, `appendNewsCard`, `appendQuoteCard`, `buildNewsCard`) and `.briefing-card` CSS from failed card experiments. Safe to remove.

---

## How to run locally

```bash
git clone https://github.com/lagr8dane/ea-watch.git
cd ea-watch
npm install
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
- **Sessions PK is `token` (not `id`).** All session queries use `token`. `chain_state.session_id` and `action_log.session_id` reference `sessions(token)`.
- **Auth library:** bcryptjs (not bcrypt — native binary fails on Vercel Linux).
- **DB client exports:** `query`, `queryOne`, `execute` — never `db`.
- **No `requireOwnerSession` helper.** Session validation is inline in each API handler — parse cookie, query sessions table, check expiry and is_shell.
- **Nav drawer is inlined** in each HTML page — not loaded from `nav.js` (timing issues with external script).
- **SSE cards don't work.** Large JSON payloads sent over SSE get split across network chunks and fail silently client-side. Text streaming only.
- **Briefing data fetch is inlined in `ea.js`** — `fetchWeatherData()`, `fetchNewsData()` etc. defined directly in `ea.js`. Do NOT call `/api/briefing` from within `ea.js` — Vercel serverless functions cannot reliably call themselves via HTTP.

---

## File structure

```
api/
  tap.js                gateway handler
  auth.js               challenge-response + lockout
  ea.js                 Claude streaming + chain engine + briefing intents + weather/news fetch
  config.js             owner config read/write
  chains.js             chain CRUD — all /api/chains/* routes handled here
  chain-execute.js      chain execution control + action log reader
  briefing.js           standalone weather+news endpoint (used for direct /api/briefing testing)
  upload.js             profile photo upload to Vercel Blob
  device.js             device registration + transfer
  config/public.js      stranger-safe config endpoint (edge-cached 5min)
  dev/tap.js            NFC stub (ENABLE_STUB gate)
public/
  contact.html          stranger card
  ea.html               EA chat UI (has known bugs — see above)
  challenge.html        auth challenge
  config.html           owner settings
  chain-builder.html    routines builder UI
  action-log.html       action log viewer
  stub.html             tap simulator
  nav.js                nav drawer reference (actual nav inlined per page)
lib/
  auth.js               tokens, bcryptjs, session state helpers
  audit.js              tap log writer
  ratelimit.js          lockout logic
  alert.js              danger word alert dispatcher
  chain-engine.js       core chain sequencer
  action-log.js         action log writer and reader
  actions/
    deeplinks.js        iOS/Android deeplink URL builders
    shortcuts.js        Siri Shortcuts builder
    conditional.js      weather/time/calendar conditional evaluators
db/
  schema.sql            Phase 1 schema (5 tables)
  schema-phase2.sql     Phase 2 schema reference
  client.js             Turso client — exports query, queryOne, execute
scripts/
  db-init.js            Phase 1 migration
  db-migrate-phase2.js  Phase 2 migration (chains, chain_steps, chain_state, action_log)
  db-migrate-avatar.js  Adds avatar_url to owner_config
  db-migrate-briefing.js Adds last_briefing_date to owner_config
server.js               local dev server
vercel.json             routing — explicit rewrites + functions block
```

---

## DB schema summary

**Phase 1:** devices, sessions, tap_log, auth_attempts, owner_config

**owner_config extra columns added post-Phase 1:**
- `avatar_url TEXT` — Vercel Blob URL for profile photo
- `last_briefing_date TEXT` — YYYY-MM-DD, tracks first-tap-of-day for morning briefing

**Phase 2 additions:**
- `chains` — FK: device_id → devices(id)
- `chain_steps` — FK: chain_id → chains(id)
- `chain_state` — FK: session_id → sessions(token), chain_id → chains(id)
- `action_log` — FK: session_id → sessions(token)

---

## Briefing system

**Intent detection in `ea.js`:**
- "weather" / "how's the weather" / "weather today" → `type = 'weather'`
- "top news" / "headlines" / "what's the news" → `type = 'news'`
- "morning quote" / "inspire me" → `type = 'quote'`
- "morning briefing" / "start my day" → `type = 'morning'`

**`streamBriefing()` in `ea.js`:**
- `weather` → fetches Open-Meteo, streams Claude text response
- `news` → fetches NewsAPI (6 stories, AP RSS fallback), streams Claude text response
- `quote` → streams Claude motivational quote (plain text)
- `morning` → sends `{ morning_briefing: true }` SSE event only

**Client flow for morning:**
1. Receives `morning_briefing: true` event
2. `sendBriefingPart()` fires 'weather' request → text bubble
3. `sendBriefingPart()` fires 'top news' request → text bubble
4. `sendBriefingPart()` fires 'morning quote' request → text bubble

**First-tap-of-day:** `checkFirstTapToday()` compares `last_briefing_date` to today. Auto-triggers morning briefing on first message of the day.

**Location:** Client requests GPS on load, caches in `sessionStorage`, passes `lat`/`lon`/`localHour` with every EA request. Server falls back to Reno NV (39.5296, -119.8138).

---

## Phase 3 remaining work

1. Fix ea.html hang (see Known Bugs above)
2. Clean up dead card code in ea.html
3. Make morning briefing three-part flow reliable
4. **Chain suggestion from conversation** — user describes a routine in natural language, EA proposes a chain with steps, user approves with one tap and it saves to the DB
5. **How are you feeling check-in** — EA asks at session start, responds contextually
6. **On-demand workout/stretch** — Claude generates a bodyweight routine based on context

---

## Environment variables

```
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
ANTHROPIC_API_KEY
RESEND_API_KEY
ALERT_FROM_EMAIL
NEWSAPI_KEY
BLOB_READ_WRITE_TOKEN
ENABLE_STUB=true (local) / false (production)
APP_URL=http://localhost:3000 (local) / https://ea-watch.vercel.app (production)
NODE_ENV=development (local) / production (Vercel)
```

---

## vercel.json notes

- `functions` block (`"api/**/*.js"`) required for Vercel to detect serverless functions
- Parameterised API routes need explicit rewrites: `/api/chains/:id` etc. → `/api/chains`
- `/api/chain-execute/log` → `/api/chain-execute` (handled inside default export by checking pathname)
- Page routes: `/chains` → `chain-builder.html`, `/action-log` → `action-log.html`

---

## Owner

Marco Rota. Technology executive, Reno NV.
Comfortable with code. Prefers to understand decisions, not just receive them.
Building for personal use first, potential productisation later.
GitHub: lagr8dane/ea-watch
