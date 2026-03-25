# EA Watch

A custom wristwatch with an NFC chip in the case back. Tap the watch with your phone and you get one of two experiences depending on who you are.

**Owner** → Authenticated personal AI assistant. Voice and text. Chain automation. Personal operating surface.  
**Stranger** → Polished contact gateway. LinkedIn, Instagram, booking, iMessage/WhatsApp, optional **Add to Contacts** (.vcf).

The same physical object. Two entirely different experiences, determined by identity at the moment of tap.

---

## V1 (production)

**V1 is the current shipping baseline** on `main` at `https://ea-watch.vercel.app`: identity, EA chat, briefings & chips, routines, tasks, interest radar (**Ideas** + **Find places** with Google Places when configured), contact card polish, and a reorganized settings app. Later work is **post‑V1** (productivity depth, richer automation, optional cloud STT, etc.) — see [HANDOFF.md](HANDOFF.md) for backlog.

---

## Current status

| Area | Status |
|---|---|
| Identity, tap gateway, auth, sessions, shell mode | ✅ |
| Stranger contact card (focus, accent, links, Instagram, optional .vcf) + `/contact` | ✅ |
| Config app — grouped sections (You & card, Assistant, Access & safety, Device) | ✅ |
| EA chat (Claude streaming, Web Speech input, plain-text formatting) | ✅ |
| **Routines** — `/chains`, CRUD, engine, deeplinks/shortcuts/conditionals | ✅ |
| **Media in routines** — Deeplink **`url`** for **Apple Podcasts** / **Apple Music** share links (`podcasts.apple.com`, `music.apple.com`); **`spotify`** kind for Spotify URIs/URLs | ✅ |
| **Routines picker** + **Tasks** chip | ✅ |
| **Morning briefing** — JSON panels (weather, news, quote, stocks) | ✅ |
| **Quick chips** — Briefing, News, Weather, Mindful, Inspire me, Routines, Tasks, **Radar** | ✅ |
| **Interest radar** — **Ideas** (Claude + web, free-text prompt; Settings topics pre-fill once) + **Find places** (type chips + descriptor, `GOOGLE_PLACES_API_KEY`); form order **what → when → where**; Copy / tasks | ✅ |
| **Copy to clipboard** — EA bubbles/panels; radar cards | ✅ |
| Action log `/action-log` | ✅ |

**Post‑V1 themes:** productivity (focus, calendar-adjacent), optional **POI enrichment** beyond Places text search, voice/TTS only where validated. **Podcasts:** open in Apple Podcasts / Spotify via routine deeplinks — EA does not embed a player (see [HANDOFF.md](HANDOFF.md) for defaults discussion).

---

## Live URLs

| Page | URL |
|---|---|
| Tap gateway | `https://ea-watch.vercel.app/` |
| EA chat | `https://ea-watch.vercel.app/ea` |
| Tasks | `https://ea-watch.vercel.app/tasks` |
| Interest radar | `https://ea-watch.vercel.app/interest-radar` |
| Routines (chain builder) | `https://ea-watch.vercel.app/chains` |
| Action log | `https://ea-watch.vercel.app/action-log` |
| Contact card | `https://ea-watch.vercel.app/contact` |
| Challenge | `https://ea-watch.vercel.app/challenge` |
| Config app | `https://ea-watch.vercel.app/config` |
| Privacy | `https://ea-watch.vercel.app/privacy` |
| Terms of service | `https://ea-watch.vercel.app/terms` |
| NFC stub (dev only) | `https://ea-watch.vercel.app/stub` |

---

## Project structure

```
ea-watch/
├── api/
│   ├── tap.js, auth.js, device.js
│   ├── ea.js                   # Claude stream + chains + briefing intents + routine picker
│   ├── morning-briefing.js     # JSON briefing panels
│   ├── interest-radar.js       # Geocode + Ideas (Claude web) + Places (Google Text Search)
│   ├── briefing.js
│   ├── chains.js, chain-execute.js
│   ├── config.js, upload.js
│   ├── config/public.js
│   └── dev/tap.js
├── public/
│   ├── ea.html, config.html, interest-radar.html, contact.html, privacy.html, terms.html, nav.js, legal-footer.js, …
├── lib/
│   ├── briefing-data.js        # Weather, news, reverse geocode label
│   ├── geocode.js              # Photon + Open-Meteo; Nominatim; radar distances
│   ├── interest-radar.js       # Claude web search + JSON items (Ideas)
│   ├── places-radar.js         # Google Places API (New) text search (Find places)
│   ├── chain-engine.js, action-log.js
│   └── actions/ (deeplinks, shortcuts, conditional)
├── db/
├── scripts/                    # db-init, phase migrations, stranger_instagram, …
├── server.js
└── vercel.json
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Hosting | Vercel | Serverless, deploys on push |
| Database | Turso (SQLite edge) | Edge-hosted, low ops |
| AI | Anthropic Claude | EA chat, Ideas radar, web search tool |
| Places | Google Places API (New) | Optional **Find places** radar mode |
| Auth | bcryptjs + HttpOnly cookies | No JWTs in localStorage |
| Frontend | Vanilla HTML/CSS/JS | Mobile-first, no build step |
| Voice input | Web Speech API | Browser-native on `/ea` |

---

## Local development

### Prerequisites
- Node.js 18+
- Turso account + database
- Anthropic API key

### Setup

```bash
git clone https://github.com/lagr8dane/ea-watch.git
cd ea-watch
npm install
cp .env.example .env
# Fill in .env with your values
node --env-file=.env scripts/db-init.js
# Existing DBs: run any pending scripts in scripts/ (e.g. db-migrate-stranger-instagram.js)
npm run dev
```

Server runs at `http://localhost:3000` (`npm run dev` is `node --env-file=.env server.js`).

**Note:** Do not use `vercel dev` for this project — use `npm run dev` instead.

### Environment variables

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
ANTHROPIC_API_KEY=your-key
NEWSAPI_KEY=your-key (optional — richer news in briefings; RSS fallback without it)
GOOGLE_PLACES_API_KEY=your-key (optional — Interest radar “Find places” mode)
SPOTIFY_CLIENT_ID= / SPOTIFY_CLIENT_SECRET= (optional — EA “Play …” + Settings → Spotify)
BLOB_READ_WRITE_TOKEN= (Vercel Blob — profile photo upload)
RESEND_API_KEY=your-key (optional — danger word email alerts)
ALERT_FROM_EMAIL=alerts@yourdomain.com (optional)
ENABLE_STUB=true (local) / false (production)
APP_URL=http://localhost:3000 (local)
NODE_ENV=development (local)
```

### Register test device (run once)

```bash
curl -X POST http://localhost:3000/api/device \
  -H "Content-Type: application/json" \
  -d '{"uid":"04A1B2C3D4E5F6","device_code":"test-device-001","notes":"dev stub"}'
```

---

## Deployment

```bash
git push origin main
```

Vercel auto-deploys on every push. Set environment variables in the Vercel dashboard (`ENABLE_STUB=false`, `NODE_ENV=production`, production Turso credentials, etc.).

---

## Authentication

### Three credentials

| Credential | Purpose | Behaviour |
|---|---|---|
| PIN | 4–6 digit numeric. Routine re-auth. | Rate limited — 5 attempts then 30-min lockout. |
| Access word | Passphrase. Cold session auth. | Same rate limiting. |
| Danger word | Duress credential. | Authenticates normally. Opens shell EA. Fires silent alert to trusted contact. |

### Session states

| State | Condition | Behaviour |
|---|---|---|
| Active | Within configured window (default 60 min) | EA opens directly |
| Warm | 1–8 hours past window | Light challenge |
| Cold | 8+ hours | Full challenge |
| Unknown | Unrecognised device | Contact card only |

### Challenge style (configurable in config app)

- `word_then_pin` — passphrase first, PIN as fallback (default)
- `word` — passphrase only
- `pin` — PIN only

---

## Security

Three non-negotiables enforced in code:

1. **UID + device code dual validation** — both checked together on every tap, never either alone
2. **HttpOnly cookies** — session tokens never in localStorage, not accessible to JavaScript
3. **Server-side lockout** — 5 failed attempts → 30-min lockout stored in the DB, cannot be cleared client-side

Additional: session expiry on EA and config endpoints. Shell sessions cannot access config.

---

## Privacy & EA chat data

- **No server-side chat transcript:** Ordinary EA conversation (questions and replies) is **not** written to the database. The browser keeps a **short in-memory history** for the current `/ea` tab so the next request can include recent turns; **reloading the page clears it**.
- **`action_log`:** The DB records **structured events** for some flows (e.g. routine picker, task actions from chat, weather/news/briefing chips, chain steps, interest radar) — **metadata and action types**, not a full copy of every message. See `/action-log` in the app.
- **Claude (Anthropic):** Message content is sent to Anthropic’s API per request. **Retention and processing** there follow [Anthropic’s policies](https://www.anthropic.com/legal/privacy), not this repo.

---

## NFC hardware

**Chip:** NTAG213 anti-metal. 144 bytes. 13.56MHz.  
**NDEF format:** `https://tap.yourdomain.com?d=[device-code]`  
**UID:** 7-byte hardware identifier, burned at manufacture.  
**Write tool:** NFC Tools (wakdev) — iOS or Android.

---

## Build phases (historical)

| Phase | Scope | Status |
|---|---|---|
| 1 | Identity + gateway, auth, EA chat, config, NFC stub | ✅ Complete |
| 2 | Routines (chain builder), OS delegation, action log | ✅ Complete |
| 3 | Briefing panels, chips, mindful, weather, interest radar | ✅ Complete |
| **V1** | **Radar Ideas/Places, contact + settings polish, Places env** | ✅ **Shipped** |
| Post‑V1 | Productivity depth, automation, optional STT/TTS, POI polish | 🔲 |

---

## Future integrations (optional)

| Direction | Notes |
|---|---|
| **Google Places** | **In use** for radar **Find places** (`lib/places-radar.js`). Hours/open-now UX can deepen later. |
| **Yelp / Foursquare** | Alternative or second source; attribution and limits per ToS. |
| **Cloud STT** | If Web Speech API is insufficient after real-world use. |
| **TTS / “spoken briefing”** | Typically text briefing → TTS API; not a separate “spoken news API.” |
| **Podcasts / Apple Music** | **Routines → Deeplink → kind `url`:** paste show/episode links from **Share** in Apple Podcasts (`podcasts.apple.com`) or Apple Music (`music.apple.com`); iOS hands off to the native app. **Spotify:** use deeplink kind **`spotify`** with a URI or open.spotify URL. Optional: Siri Shortcut for “resume my show.” No in-app player planned. |

---

## Owner

Marco Rota — building for personal use first, potential productisation later.  
GitHub: lagr8dane/ea-watch
