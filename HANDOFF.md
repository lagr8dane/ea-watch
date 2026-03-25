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
- **Deeplink `kind: url`** — arbitrary `https://` / `http://` (escape hatch). On iOS, **Apple Podcasts** and **Apple Music** share URLs (`podcasts.apple.com`, `music.apple.com`) typically open in the native apps (universal links). **Spotify** remains **`kind: spotify`** with URI or `open.spotify.com` URL.
- **Chain builder UX:** changing **Deeplink kind** or **Action type** re-renders step fields so the **URL** input appears for `url` (fix landed post–V1 polish).
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
- **Public contact card (`/contact`):** **`api/config/public.js`** serves one row with **`ORDER BY datetime(updated_at) DESC`** (correct row if multiple `owner_config`), **`Cache-Control: private, no-store`**, and duplicate keys where useful (**`instagram` + `stranger_instagram`**, **`calendly` + `stranger_calendly`**). **`public/contact.html`** uses **`fetch(..., { cache: 'no-store' })`**, **`cleanSocial()`** (ZWSP strip), and **`linkedinHref` / `instagramHref` / `calendlyHref`** so bare `linkedin.com/…`, `instagram.com` or `instagr.am/…`, and `calendly.com/…` become valid **`https://`** links (Calendly keeps **`?query`** when normalizing).

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

### Podcasts / Apple Music / spoken news (routines)

- **Apple Podcasts:** In **Podcasts** → show or episode → **Share** → **Copy link**. In `/chains`, add a step **Deeplink** → kind **`url`** → paste `https://podcasts.apple.com/...` (same pattern as **Apple Music** with `https://music.apple.com/...`).
- **Spotify:** Deeplink kind **`spotify`** + playlist/track/episode URI or `https://open.spotify.com/...` (see `lib/actions/deeplinks.js`).
- **Briefing:** optional TTS later — not a separate “spoken news API”; EA does not embed podcast playback.

#### Should we ship a default set of podcast (or media) links?

**Today:** No seeded chains or default URLs — routines are entirely owner-authored.

| Direction | Pros | Cons |
|-----------|------|------|
| **No product defaults** | No wrong recommendations; no stale/broken Apple IDs; no regional store mismatches; aligns with “personal OS” | New owners have no examples |
| **Docs / README examples only** | Copy-paste shows without DB or migrations | Still manual |
| **Optional “starter” chain in repo** | e.g. JSON export or documented steps for “Morning: weather + one show” | Must decide whose taste; links need occasional review |
| **Per-owner config (future)** | e.g. `favorite_podcasts[]` in `owner_config` feeding EA suggestions | Schema + UI + privacy scope |

**Recommendation for now:** Keep **no automatic defaults** in the app; use **README + HANDOFF** (and optional personal starter chains Marco copies in `/chains`). If we add defaults later, prefer **owner-configured list** over hard-coded global shows.

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
- **EA Q&A not persisted:** `/api/ea` does **not** store user questions or assistant answers in Turso. The client sends the last **~20** turns (sanitised `role` + `content`, capped length) per request; only **specific intents** call `logUserEvent` → `action_log` (tasks, briefings, routine menu, etc.) with JSON **metadata**, not a full chat dump.
- **Third-party AI:** Anthropic receives conversation turns for each call; corporate retention is outside this codebase (document in README for owners).

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
public/chain-builder.html Routines UI (deeplink kinds incl. url; re-render on kind change)
public/interest-radar.html
public/config.html        Settings (grouped sections, tap-meet nested details)
public/contact.html       Public card + optional .vcf (`/api/config/public`, URL helpers, no-store fetch)
public/privacy.html       Privacy policy (nav + footer links from app shell)
public/terms.html         Terms of service
public/legal-footer.js    Injects visible Privacy · Terms (strip above EA input bar, else page footer)
```

---

## DB notes

- **owner_config:** `briefing_interests`, `briefing_tickers`, `interest_radar_topics`, `stranger_*` including **`stranger_instagram`**, `stranger_focus`, `stranger_accent_hex`, etc. Run **`scripts/db-migrate-stranger-instagram.js`** on older DBs.
- **Phase 2:** `chains`, `chain_steps`, `chain_state`, `action_log`.
- **`action_log`:** Audit / owner-visible log (`lib/action-log.js`, `lib/user-event-log.js`). Rows tie to **`session_id`** (session token); **`action_config`** is event-specific JSON — **not** a replacement for chat history storage.

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
