# EA Watch — Session Handoff

Paste this file into a new Claude or Cursor session to resume building.

---

## What this project is

A custom wristwatch with an NTAG213 anti-metal NFC chip in the case back. Anyone who taps the watch with their phone gets one of two experiences based on identity:

- **Owner** → Authenticated personal AI assistant (EA). Voice + text. **Routines** (saved chains). **Briefings** (weather / news / stocks panels). **Mindful** and **Inspire me**. **Interest radar** (Ideas + Find places). **Tasks**.
- **Stranger** → Polished **contact card**: name, title, focus, accent, bio, LinkedIn, Instagram, booking, iMessage/WhatsApp, optional **Add to Contacts** (.vcf download). Profile photo when set.

---

## Current state — **V1 shipped**

**Production:** `https://ea-watch.vercel.app` — repo `lagr8dane/ea-watch`, **`main`** branch.

### Phase 1 — Identity + gateway

- Turso DB, tap gateway (UID + device code), auth (PIN / access / danger word), sessions, shell mode + alerts
- Stranger contact card, challenge UI, **config app** (grouped: **You & contact card**, **Assistant**, **Access & safety**, **Device**), profile photo (Vercel Blob), NFC stub (`ENABLE_STUB`)
- **`stranger_instagram`** on `owner_config` — migration `scripts/db-migrate-stranger-instagram.js`; public card button; `#tap-meet` on `/config`
- **`public/contact-setup.html`** redirects to `/config#tap-meet` (guided setup)

### Phase 2 — Routines (chains)

- Builder UI `/chains` → `chain-builder.html`; CRUD `api/chains.js`
- Engine `lib/chain-engine.js` — silent / confirmable / required / conditional steps; state in `chain_state` (session keyed by `sessions.token`)
- OS delegation: `lib/actions/deeplinks.js`, `shortcuts.js`; conditionals `conditional.js`
- EA integration in `api/ea.js` — trigger match **after** routine picker; SSE for actions + chain controls
- Action log `/action-log`

### Phase 3 + V1 — EA experience + radar + contact polish

- **No auto morning briefing** on first open. User uses **chips** or phrases.
- **Morning briefing** — `api/morning-briefing.js` returns **JSON** (`items` / `panels`). `ea.html` renders panels. Weather, news, quote, stocks from config.
- **Shared data** — `lib/briefing-data.js` (Open-Meteo, Nominatim label), news (NewsAPI + RSS fallback).
- **Quick chips**: Briefing, News, Weather, Mindful, Inspire me, Routines, Tasks, **Radar** (hidden in shell). **Radar** → `/interest-radar?auto=1&when=tonight` (and `kind=` when used).
- **Interest radar** (`/interest-radar`, `api/interest-radar.js`):
  - **Form order:** mode → **what** (Ideas textarea *or* Places chips + descriptor) → **When** → **Where are you?** → radius → Run.
  - **Ideas:** single **“What you’re looking for”** textarea; **once** pre-filled from Settings **`interest_radar_topics`** if empty; **`idea_prompt`** sent to API. Server **does not** re-merge Settings topics into `interests[]` when `idea_prompt` is set (avoids duplicate Claude brief). Claude + web search — `lib/interest-radar.js`.
  - **Find places:** checkboxes (restaurant, bar, café, …) + **More specific** line; query string → `parseRadarInterests`. **`GOOGLE_PLACES_API_KEY`** required — `lib/places-radar.js` (Places API **New** `places:searchText`). **`openNow`** when **Tonight**.
  - Geocode / reverse unchanged; distances `lib/geocode.js` (venue lat/lon from Places skips re-geocode).
  - UI: working state, due presets + custom date, **Copy** right-aligned on cards, **Add task**.
- **Copy to clipboard** — EA bubbles/panels; radar cards.
- **Shell** — no radar, no full config, Radar chip hidden.

---

## Post‑V1 (next themes)

- **Productivity** — tasks depth, focus, calendar-adjacent flows.
- **Radar** — in-chat summary without full-page navigation; stronger empty/rural UX; optional POI enrichment beyond text search.
- **Voice** — Web Speech on `/ea` today; defer global mic / cloud STT until usage proves need.
- **Backlog** — meal-planning JSON panel, chain-from-NL, task `source_url` — see older bullets in git history if needed.

---

## Ideas backlog (not scheduled)

### AI meal suggestions, recipes, shopping lists

- Structured JSON panel; config for diet/household; disclaimers for allergies. Gmail OAuth out of scope.

### Yelp / alternate POI

- Places covers **Find places** v1; Yelp/Foursquare still optional for ratings/attribution diversity.

### Podcasts / spoken news

- Prefer **deeplinks** to Apple/Spotify; briefing → optional TTS later — not a separate “spoken news API.”

---

## How to run locally

```bash
git clone https://github.com/lagr8dane/ea-watch.git
cd ea-watch
npm install
cp .env.example .env   # fill values
npm run dev            # → http://localhost:3000
```

**Do not use `vercel dev`** — use `npm run dev`.

---

## Key architecture decisions (do not revisit without explicit owner OK)

- **EA orchestrates; OS executes.** Deeplinks and Shortcuts for real device actions.
- **Auth:** UID+code dual validation, HttpOnly cookies, server-side lockout.
- **DB:** Turso SQLite. Session joins use **`sessions.token`** (text).
- **bcryptjs** (not bcrypt) on Vercel.
- **Exports:** `query`, `queryOne`, `execute` from `db/client.js`.
- **Briefing JSON:** **`/api/morning-briefing`** / panel fetch — not large JSON inside Claude SSE text.
- **`api/ea.js`** imports `lib/briefing-data.js` directly — no HTTP self-call to `/api/briefing` in the same invocation.

---

## File structure (high signal)

```
api/ea.js                 Claude + chains + briefing + routine picker SSE
api/morning-briefing.js   JSON panels
api/interest-radar.js     Geocode, reverse, Ideas (Claude), Places (Google)
api/config.js             Owner config (+ briefing + interest_radar_topics + stranger_* )
lib/briefing-data.js      Weather, news, location_label
lib/geocode.js            Forward/reverse, radar distance enrichment
lib/interest-radar.js     Ideas: Claude + web search
lib/places-radar.js       Find places: Google Places searchText
public/ea.html            Chat, chips, Copy, voice, panels
public/interest-radar.html
public/config.html        Settings (grouped sections, tap-meet nested details)
public/contact.html       Public card + optional .vcf
```

---

## DB notes

- **owner_config:** `briefing_interests`, `briefing_tickers`, `interest_radar_topics`, `stranger_*` including **`stranger_instagram`**, `stranger_focus`, `stranger_accent_hex`, etc. Run **`scripts/db-migrate-stranger-instagram.js`** on older DBs.
- **Phase 2:** `chains`, `chain_steps`, `chain_state`, `action_log`.

---

## Environment variables

```
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
ANTHROPIC_API_KEY
NEWSAPI_KEY              # optional
GOOGLE_PLACES_API_KEY    # optional — radar Find places
BLOB_READ_WRITE_TOKEN    # profile photo
RESEND_API_KEY, ALERT_FROM_EMAIL  # optional alerts
ENABLE_STUB, APP_URL, NODE_ENV
```

---

## vercel.json

- `functions` for `api/**/*.js`
- Rewrites for `/api/*`, static HTML routes (`/chains`, `/action-log`, etc.)

---

## Owner

Marco Rota — Reno, NV. Building for personal use first.  
GitHub: **lagr8dane/ea-watch**
