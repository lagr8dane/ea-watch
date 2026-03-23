# EA Watch

A custom wristwatch with an NFC chip in the case back. Tap the watch with your phone and you get one of two experiences depending on who you are.

**Owner** → Authenticated personal AI assistant. Voice and text. Chain automation. Personal operating surface.  
**Stranger** → Polished contact gateway. LinkedIn, booking, iMessage/WhatsApp.

The same physical object. Two entirely different experiences, determined by identity at the moment of tap.

---

## Current status

**Phase 1 — in progress.** Core infrastructure complete and running locally. Security review pass remaining before Phase 1 is closed.

| Task | Status |
|---|---|
| Turso DB schema + client | ✅ Done |
| Project scaffold + Vercel config | ✅ Done |
| Shared lib: session token + bcrypt | ✅ Done |
| Shared lib: audit log | ✅ Done |
| Device registration endpoint | ✅ Done |
| Tap gateway handler | ✅ Done |
| Session management | ✅ Done |
| Challenge-response auth | ✅ Done |
| Rate limiting + server-side lockout | ✅ Done |
| Danger word + shell mode | ✅ Done |
| Alert dispatcher | ✅ Done |
| Stranger contact card | ✅ Done |
| Challenge UI | ✅ Done |
| EA chat interface | ✅ Done |
| EA streaming endpoint | ✅ Done |
| Config app UI | ✅ Done |
| Config read/write endpoint | ✅ Done |
| Ownership transfer flow | ✅ Done |
| NFC stub endpoint | ✅ Done |
| NFC stub UI | ✅ Done |
| Security review pass | 🔲 Next |
| Deploy + smoke test | 🔲 Next |

---

## Project structure

```
ea-watch/
├── api/                        # Vercel serverless functions
│   ├── tap.js                  # Gateway — UID+device code validation, session routing
│   ├── auth.js                 # Challenge-response, rate limiting, lockout, danger word
│   ├── ea.js                   # EA chat endpoint — streams Claude API
│   ├── config.js               # Owner config read/write (session gated)
│   ├── device.js               # Device registration + ownership transfer
│   ├── config/
│   │   └── public.js           # Public config endpoint (stranger card fields only)
│   └── dev/
│       └── tap.js              # NFC stub endpoint (ENABLE_STUB gate)
├── public/                     # Static HTML — served to phone browser
│   ├── contact.html            # Stranger contact card
│   ├── ea.html                 # Owner EA chat interface
│   ├── challenge.html          # Auth challenge UI
│   ├── config.html             # Owner config app
│   └── stub.html               # NFC tap simulator (dev only)
├── lib/                        # Shared utilities
│   ├── auth.js                 # Token generation, bcrypt, session state machine
│   ├── audit.js                # Tap audit log writer
│   ├── ratelimit.js            # Rate limiting + server-side lockout
│   └── alert.js                # Danger word alert dispatcher
├── db/
│   ├── schema.sql              # Database schema (5 tables)
│   └── client.js               # Turso client + query helpers
├── scripts/
│   └── db-init.js              # Applies schema to Turso
├── server.js                   # Local dev server (replaces vercel dev)
├── .env.example                # Environment variable template
├── package.json
└── vercel.json
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Hosting | Vercel | Serverless, deploys on push, free tier |
| Database | Turso (SQLite edge) | Zero config, edge-hosted, free tier |
| AI | Anthropic Claude API (claude-sonnet-4-5) | Powers EA chat, streaming |
| Auth | bcrypt + HttpOnly cookies | No JWTs in localStorage |
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
node --env-file=.env server.js
```

Server runs at `http://localhost:3000`.

### Environment variables

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
ANTHROPIC_API_KEY=your-key
RESEND_API_KEY=your-key (optional for now)
ALERT_FROM_EMAIL=alerts@yourdomain.com (optional for now)
ENABLE_STUB=true
APP_URL=http://localhost:3000
NODE_ENV=development
```

### NFC stub

With `ENABLE_STUB=true`, open `http://localhost:3000/stub` to simulate tap scenarios:

- **Owner — active session** → EA opens directly
- **Owner — expired session** → Challenge screen
- **Stranger tap** → Contact card
- **Danger word entry** → Shell EA + silent alert

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

Vercel auto-deploys on every push. Environment variables are set in Vercel dashboard → Settings → Environment Variables.

Production env vars match `.env.example` with:
- `ENABLE_STUB=false`
- `NODE_ENV=production`
- `APP_URL=https://your-vercel-domain.vercel.app`

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

## Security non-negotiables

Three items must be present at all times:

1. **UID + device code dual validation** — both checked together on every tap
2. **HttpOnly cookies** — session tokens never in localStorage
3. **Server-side lockout** — 5 failed attempts → 30-min lockout in DB, cannot be cleared client-side

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
| 1 | Identity + gateway, auth, EA chat, config app, NFC stub | 🔨 In progress |
| 2 | Manual chain builder, OS delegation, action log | Not started |
| 3 | Pattern detection, proactive suggestions | Not started |
| 4 | Autonomous execution (per-chain opt-in) | Not started |

---

## New session handoff

To resume building in a new Claude session, paste the system prompt from the project spec at the top of the conversation, then add:

> Phase 1 is complete except for the security review pass (task 21) and production smoke test (task 22). All code is committed to GitHub at lagr8dane/ea-watch. The local dev server runs via `node --env-file=.env server.js`. The NFC stub is working at /stub. The EA chat is working at /ea. Next step is the security review pass.

---

## Owner

Marco Rota — building for personal use first, potential productisation later.  
GitHub: lagr8dane/ea-watch
