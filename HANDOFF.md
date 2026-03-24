# EA Watch — Session Handoff

Paste this file into a new Claude or Cursor session to resume building.

---

## What this project is

A custom wristwatch with an NTAG213 anti-metal NFC chip in the case back. Anyone who taps the watch with their phone gets one of two experiences based on identity:

- **Owner** → Authenticated personal AI assistant (EA). Voice and text. **Routines** (saved chains). **Briefings** (weather / news / stocks panels). **Mindful** and **Inspire me** shortcuts.
- **Stranger** → Polished contact gateway. LinkedIn, book a meeting, iMessage/WhatsApp. Profile photo shown.

---

## Current state

**Production:** `https://ea-watch.vercel.app` — repo `lagr8dane/ea-watch`, `main` branch.

### Phase 1 — Identity + gateway

- Turso DB, tap gateway (UID + device code), auth (PIN / access / danger word), sessions, shell mode + alerts
- Stranger contact card, challenge UI, config app, profile photo (Vercel Blob), NFC stub (`ENABLE_STUB`)

### Phase 2 — Routines (chains)

- Builder UI `/chains` → `chain-builder.html`; CRUD `api/chains.js`
- Engine `lib/chain-engine.js` — silent / confirmable / required / conditional steps; state in `chain_state` (session keyed by `sessions.token`)
- OS delegation: `lib/actions/deeplinks.js`, `shortcuts.js`; conditionals `conditional.js` (weather, time, calendar webhook)
- EA integration in `api/ea.js` — trigger match **after** routine picker; SSE for actions + chain controls
- Action log `/action-log`

### Phase 3 — EA experience (briefings, chips, mindful)

- **No auto morning briefing** on first open. User uses **chips** or phrases.
- **Morning briefing** — `api/morning-briefing.js` returns **JSON** (`items` / `panels`). Client `ea.html` renders **panels** (not large JSON over SSE). Weather, news (+ load more, Google News explore link in panel), quote, optional stocks from `briefing_tickers`.
- **Shared data** — `lib/briefing-data.js` (Open-Meteo weather, `location_label` via Nominatim + lat/lon fallback), news (NewsAPI + RSS fallback), `googleNewsSearchUrl`.
- **Briefing intents** in `api/ea.js` — weather, news, morning → `briefing_panels_fetch` or `morning_briefing`; **mindful** (random breathing vs stretching, Claude stream) with **panel** + icon via SSE `mindful_panel`; **quote** / “inspire me” short motivational stream.
- **Quick chips** (under greeting): Briefing, News, Weather, Mindful, Inspire me, **Routines**, **Tasks**, **Radar** (non–shell only). **Radar** → `/interest-radar?auto=1&when=tonight` (+ debug if EA has `debug=1`).
- **Routine picker** — phrases like `routines`, `what can you run?`, `which routines`, etc. (see `detectRoutinePickerIntent` in `api/ea.js`). Returns SSE `routine_chips: [{ label, trigger, subtitle? }]`. Chips show **Say: &lt;trigger&gt;** when name ≠ trigger. Tap sends trigger text → normal chain match.
- **Config** — `briefing_interests`, `briefing_tickers`, **`interest_radar_topics`** in `api/config.js` + `config.html`. Migrations: `scripts/db-migrate-briefing-settings.js`, **`scripts/db-migrate-interest-radar.js`** (`npm run db:migrate:interest-radar`).
- **Interest radar** — `/interest-radar`: verify address or **Use my location**; radius + **When** (tonight / …); interests from textarea + Settings **`interest_radar_topics`**. **`POST /api/interest-radar`** (see `api/interest-radar.js`, `lib/interest-radar.js`, `lib/geocode.js`): Claude **web search**, URLs required per item; geocode for **~mi** (Photon + Open-Meteo parallel, bbox bias near anchor; capped batch). **Auto-run from EA:** loads config, **`ea_location`** sessionStorage or GPS, then search. **UI:** working spinner + disabled controls while searching; **task due** = presets (listed date if future, window anchors) + **custom date**; **Copy** per card (title, meta, summary, URL). **`ea_interest_radar`** in action log. Nav: **Radar**.
- **Copy to clipboard** — `ea.html`: **Copy** under each EA bubble/stack (text or `.mb-panel` after mindful/tasks replace bubble). `interest-radar.html`: **Copy** on each result.
- **Shell sessions** — no briefing routes / interest radar / personal chains / full config as per `is_shell` checks; **Radar chip hidden** on EA in shell.

---

## Next: productivity + discovery polish

**Productivity** remains the main theme — tasks, focus, calendar-adjacent flows, planning surfaces in EA.

**Discovery:** Interest radar v1 is **shipped** (see above). Natural extensions: **POI APIs** for food/drink (Yelp, Google Places, Foursquare) as enrichment or a parallel “restaurants near me” flow; **EA intent** “what’s on my radar…” without leaving chat (optional). Older ideas: chain-from-NL, feeling check-in — still fair game.

---

## Ideas backlog (not scheduled — capture for later)

### AI meal suggestions, recipes, and shopping lists

- **Concept:** EA proposes meals (tonight / this week), short structured recipe (time, steps summary), and a **shopping list**; optional export (**copy** is already available on EA messages; tasks/Reminders later).
- **Config:** Diet prefs, dislikes, household size, max prep time in `owner_config` (similar pattern to `briefing_interests`).
- **Delivery:** Prefer a **JSON panel** over SSE text (same lesson as morning briefing). One Claude call with strict JSON; stream optional for narrative only.
- **Risks:** Hallucinated steps/temps; **allergies / medical diets** need disclaimers and “verify packaging / safe cooking” copy — never imply medical authority.
- **Gmail:** Explicitly **out of scope** for now (OAuth, sensitivity).

### Yelp / Places-style enrichment (bars, restaurants, reliable hours)

- **Problem:** Web search is great for **events and niche** listings; **dining** often wants **ratings, hours, open-now, canonical maps/Yelp links** — structured APIs beat scraping.
- **Options:** **Yelp Fusion**, **Google Places (New)**, **Foursquare** — all need API keys, rate limits, and **ToS attribution**. **OSM/Overpass** is keyless but thin on hours/reviews.
- **Integration patterns:** (1) **Post-process** radar hits: if category looks like food, resolve name+address via Places/Yelp and attach fields. (2) **Separate chip or mode** “Eat near me” that queries POI API first, radar second. (3) **Hybrid JSON** in one response — server merges search + POI (watch latency and cost).
- **Risks:** Licensing/display rules; stale hours; cost at scale — gate behind owner config or env flags.

### Interest radar — future tweaks (core shipped)

- EA **in-chat** radar summary without full page navigation (larger UX project).
- **`source_url` on tasks** or notes field for “why this task.”
- Stronger **empty/rural** UX (suggested Google/Eventbrite search links).

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
- **DB:** Turso SQLite. Session primary key for joins is **`sessions.token`** (text), not numeric `id`.
- **bcryptjs** (not bcrypt) on Vercel.
- **Exports:** `query`, `queryOne`, `execute` from `db/client.js`.
- **Briefing JSON:** Use **`/api/morning-briefing`** (or panel fetch from EA SSE) for structured UI — **do not** ship large JSON payloads inside Claude SSE text; chunking breaks client parsing.
- **Internal briefing fetch:** `api/ea.js` imports `lib/briefing-data.js` directly — no HTTP self-call to `/api/briefing` from the same serverless invocation.

---

## File structure (high signal)

```
api/ea.js                 Claude + chains + briefing intents + routine picker SSE
api/morning-briefing.js   JSON panels for EA client
api/interest-radar.js     Address geocode + Claude web search + distances (/interest-radar)
api/briefing.js           Authenticated GET test endpoint for weather/news
api/chains.js             Chain CRUD
api/chain-execute.js      Resume chain, action log API
api/config.js             Owner config (+ briefing_interests, briefing_tickers)
lib/briefing-data.js      Weather, news, tickers parsing, location_label
lib/chain-engine.js       Chain sequencer
lib/actions/            deeplinks, shortcuts, conditional
public/ea.html            Chat UI, chips, Copy, panels, mindful panel, routine chips
public/interest-radar.html
public/chain-builder.html /chains
scripts/db-migrate-briefing-settings.js
server.js + vercel.json
```

---

## DB notes

- **Phase 2:** `chains`, `chain_steps`, `chain_state`, `action_log` (session_id → `sessions.token`).
- **owner_config:** `briefing_interests`, `briefing_tickers` via briefing-settings migration. Older migrations may reference `last_briefing_date` — **first-tap auto briefing is removed**; column may still exist in some DBs but is not required for current behavior.

---

## Environment variables

```
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
ANTHROPIC_API_KEY
NEWSAPI_KEY              # optional — news in briefings
BLOB_READ_WRITE_TOKEN    # profile photo
RESEND_API_KEY, ALERT_FROM_EMAIL  # optional alerts
ENABLE_STUB, APP_URL, NODE_ENV
```

---

## vercel.json

- `functions` block for `api/**/*.js`
- Rewrites for `/api/chains`, `/api/morning-briefing`, etc.
- `/chains` → `chain-builder.html`, `/action-log` → `action-log.html`

---

## Owner

Marco Rota — Reno, NV. Building for personal use first.  
GitHub: **lagr8dane/ea-watch**
