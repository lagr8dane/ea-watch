# EA Watch

A custom wristwatch with an NFC chip in the case back. Tap the watch with your phone and you get one of two experiences depending on who you are.

**Owner** → Authenticated personal AI assistant. Voice and text. Chain automation. Personal operating surface.  
**Stranger** → Polished contact gateway. LinkedIn, booking, iMessage/WhatsApp.

The same physical object. Two entirely different experiences, determined by identity at the moment of tap.

---

## Current status

**Phases 1–2 complete; owner EA experience (briefings, routines, mindful) is in production** at `https://ea-watch.vercel.app`.

| Area | Status |
|---|---|
| Identity, tap gateway, auth, sessions, shell mode | ✅ |
| Stranger contact card + config | ✅ |
| EA chat (Claude streaming, voice, plain-text formatting rules) | ✅ |
| **Routines** — chain builder `/chains`, CRUD, engine, deeplinks/shortcuts/conditionals | ✅ |
| **Routines picker** — say `routines` / `what can you run?` etc., or tap **Routines** chip | ✅ |
| **Morning briefing** — JSON + panel UI (weather, news, quote, optional stocks); not auto-fired on open | ✅ |
| **Quick chips** — Briefing, News, Weather, Mindful, Inspire me, Routines | ✅ |
| **Mindful** — random breathing vs stretching; panel + icon; separate from **Inspire me** (quote) | ✅ |
| **Weather** — shows **where** (reverse geocode + coordinate fallback via `lib/briefing-data.js`) | ✅ |
| Config: `briefing_interests`, `briefing_tickers` (+ migration script) | ✅ |
| Action log `/action-log` | ✅ |

**Next focus:** productivity features (see [Build phases](#build-phases)).

---

## Live URLs

| Page | URL |
|---|---|
| Tap gateway | `https://ea-watch.vercel.app/` |
| EA chat | `https://ea-watch.vercel.app/ea` |
| Routines (chain builder) | `https://ea-watch.vercel.app/chains` |
| Action log | `https://ea-watch.vercel.app/action-log` |
| Contact card | `https://ea-watch.vercel.app/contact` |
| Challenge | `https://ea-watch.vercel.app/challenge` |
| Config app | `https://ea-watch.vercel.app/config` |
| NFC stub (dev only) | `https://ea-watch.vercel.app/stub` |

---

## Project structure

```
ea-watch/
├── api/
│   ├── tap.js, auth.js, device.js
│   ├── ea.js                   # Claude stream + chains + briefing intents + routine picker
│   ├── morning-briefing.js     # JSON briefing panels (weather, news, quote, stocks)
│   ├── briefing.js             # Optional GET /api/briefing (auth) for testing
│   ├── chains.js, chain-execute.js
│   ├── config.js, upload.js
│   ├── config/public.js
│   └── dev/tap.js
├── public/
│   ├── ea.html, config.html, chain-builder.html, action-log.html, …
├── lib/
│   ├── briefing-data.js        # Weather (Open-Meteo + location label), news helpers
│   ├── chain-engine.js, action-log.js
│   └── actions/ (deeplinks, shortcuts, conditional)
├── db/
├── scripts/
│   ├── db-init.js, db-migrate-phase2.js, db-migrate-briefing-settings.js, …
├── server.js
└── vercel.json
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Hosting | Vercel | Serverless, deploys on push, free tier |
| Database | Turso (SQLite edge) | Zero config, edge-hosted, free tier |
| AI | Anthropic Claude API (claude-sonnet-4-5) | Powers EA chat, streaming |
| Auth | bcryptjs + HttpOnly cookies | No native binaries, no JWTs in localStorage |
| Frontend | Vanilla HTML/CSS/JS | Mobile-first, no build step |
| Voice input | Web Speech API | Browser-native, no backend dependency |

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
# If upgrading an existing DB: node --env-file=.env scripts/db-migrate-briefing-settings.js
npm run dev
```

Server runs at `http://localhost:3000` (`npm run dev` is `node --env-file=.env server.js`).

**Note:** Do not use `vercel dev` for this project — use `npm run dev` instead.

### Environment variables

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
ANTHROPIC_API_KEY=your-key
NEWSAPI_KEY=your-key (optional — richer news in briefings; AP RSS fallback without it)
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

Vercel auto-deploys on every push. Set all environment variables in Vercel dashboard → Settings → Environment Variables with `ENABLE_STUB=false` and `NODE_ENV=production`.

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
3. **Server-side lockout** — 5 failed attempts → 30-min lockout stored in DB, cannot be cleared client-side

Additional: session expiry enforced on EA and config endpoints. Shell sessions cannot access config.

---

## NFC hardware

**Chip:** NTAG213 anti-metal. 144 bytes. 13.56MHz. On order.  
**NDEF format:** `https://tap.yourdomain.com?d=[device-code]`  
**UID:** 7-byte hardware identifier, burned at manufacture, cannot be cloned.  
**Write tool:** NFC Tools (wakdev) — iOS or Android. Free.

All tap events are stubbed until chips arrive.

---

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Identity + gateway, auth, EA chat, config app, NFC stub | ✅ Complete |
| 2 | Routines (chain builder), OS delegation, action log | ✅ Complete |
| 3 | Briefing panels, mindful vs inspire, routine picker, chips, weather location | ✅ Substantially complete |
| **Next** | **Productivity** — tasks, focus, calendar-adjacent flows, or owner-defined priorities | 🔲 In progress |
| 4 | Pattern detection, proactive suggestions, autonomous execution (per-chain opt-in) | Not started |

---

## Owner

Marco Rota — building for personal use first, potential productisation later.  
GitHub: lagr8dane/ea-watch
