# EA Watch

A custom wristwatch with an NFC chip in the case back. Tap the watch with your phone and you get one of two experiences depending on who you are.

**Owner** → Authenticated personal AI assistant. Voice and text. Chain automation. Personal operating surface.  
**Stranger** → Polished contact gateway. LinkedIn, booking, iMessage/WhatsApp.

The same physical object. Two entirely different experiences, determined by identity at the moment of tap.

---

## How it works

Every tap follows this sequence:

1. NFC chip broadcasts a URL to the tapping phone: `https://tap.yourdomain.com?d=[device-code]`
2. Phone opens the URL in the browser — no app required, works on iOS and Android
3. Server validates the device code + hardware UID together
4. Server checks for a valid session cookie
5. Decision: known device with active session → EA | expired session → challenge | unknown device → contact card

---

## Project structure

```
ea-watch/
├── api/                    # Vercel serverless functions (one per route)
│   ├── tap.js              # Gateway handler — UID+device code validation, session routing
│   ├── auth.js             # Challenge-response, PIN/word verify, rate limit, lockout
│   ├── ea.js               # EA chat endpoint — streams Claude API response
│   ├── config.js           # Read/write owner config
│   ├── device.js           # Device registration + ownership transfer
│   ├── alert.js            # Danger word alert dispatcher
│   └── dev/
│       └── tap.js          # NFC stub endpoint (dev only, ENABLE_STUB gate)
├── public/                 # Static HTML — served directly to phone browser
│   ├── contact.html        # Stranger contact card
│   ├── ea.html             # Owner EA chat interface
│   ├── challenge.html      # Auth challenge UI
│   ├── config.html         # Owner config app
│   └── stub.html           # NFC tap simulator (dev only)
├── lib/                    # Shared utilities
│   ├── auth.js             # Token generation, bcrypt helpers, session state
│   ├── audit.js            # Tap audit log writer
│   ├── ratelimit.js        # Rate limiting + server-side lockout
│   └── alert.js            # Danger word alert dispatcher
├── db/
│   ├── schema.sql          # Database schema
│   └── client.js           # Turso client + query helpers
├── scripts/
│   └── db-init.js          # Applies schema to Turso on first run
├── .env.example            # All required environment variables
├── package.json
└── vercel.json             # Route rewrites
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Hosting | Vercel | Serverless, deploys on push, free tier covers personal use |
| Database | Turso (SQLite edge) | Zero config, works natively with Vercel, free tier |
| AI | Anthropic Claude API | Powers the EA chat interface, streaming |
| Auth | bcrypt + HttpOnly cookies | No JWTs in localStorage, server-side session management |
| Frontend | Vanilla HTML/CSS/JS | No framework — mobile-first, fast, no build step |
| Voice input | Web Speech API | Browser-native, no backend dependency |

---

## Prerequisites

- Node.js 18+
- A [Vercel](https://vercel.com) account
- A [Turso](https://turso.tech) account and database
- An [Anthropic](https://console.anthropic.com) API key
- A [Resend](https://resend.com) API key (for danger word email alerts)

---

## Local setup

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/ea-watch.git
cd ea-watch
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token
ANTHROPIC_API_KEY=your-anthropic-api-key
RESEND_API_KEY=your-resend-api-key
ALERT_FROM_EMAIL=alerts@yourdomain.com
ENABLE_STUB=true
APP_URL=http://localhost:3000
NODE_ENV=development
```

### 3. Initialise the database

```bash
npm run db:init
```

This applies `db/schema.sql` to your Turso database. Safe to run multiple times — all statements use `CREATE IF NOT EXISTS`.

### 4. Run locally

```bash
npm run dev
```

Vercel CLI runs the project locally at `http://localhost:3000`.

### 5. Simulate a tap

With `ENABLE_STUB=true`, open `http://localhost:3000/stub` in your browser. Four buttons simulate the four tap scenarios:

- Owner tap — active session (goes straight to EA)
- Owner tap — expired session (goes to challenge)
- Stranger tap (goes to contact card)
- Danger word entry (opens shell EA + fires alert)

---

## Deployment

### 1. Push to GitHub

```bash
git add .
git commit -m "initial commit"
git push origin main
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and create a new project
2. Import your GitHub repo
3. Vercel auto-detects Node.js — no build config needed

### 3. Add environment variables

In Vercel → Settings → Environment Variables, add everything from `.env.example` with production values. Set `ENABLE_STUB=false` and `NODE_ENV=production`.

### 4. Deploy

Every push to `main` deploys automatically. First deploy happens when you connect the repo.

---

## Authentication

Three credentials, each serving a different purpose:

| Credential | Purpose | Behaviour |
|---|---|---|
| PIN | 4–6 digit numeric. Routine re-auth on expired sessions. | Rate limited — 5 attempts then 30-min server-side lockout. |
| Access word | User-chosen passphrase. Higher entropy. Cold session auth. | Same rate limiting as PIN. |
| Danger word | Duress credential. Authenticates successfully. | Opens shell EA (no sensitive data). Fires silent alert to trusted contact. Coercer sees a working assistant. |

### Session states

| State | Condition | Behaviour |
|---|---|---|
| Active | Within configured window (default 60 min) | EA opens directly — no challenge |
| Warm | 1–8 hours past window | Light challenge |
| Cold | 8+ hours past window | Full challenge |
| Unknown | No session token, unrecognised device | Contact card — no challenge offered |

Session tokens are stored as HttpOnly cookies. Not accessible to JavaScript.

### Challenge style

Configurable per owner in the config app:

- `pin` — always prompt for PIN
- `word` — always prompt for access word
- `word_then_pin` — prompt for access word, PIN accepted as fallback (default)

---

## NFC hardware

**Chip:** NTAG213 anti-metal. 144 bytes. 13.56MHz.  
**Why anti-metal:** Watch case backs are metal. Standard NFC tags fail on metal. The anti-metal variant has a ferrite backing that redirects the RF field outward toward the tapper.

**NDEF record format:**
```
https://tap.yourdomain.com?d=[device-code]
```

**Hardware UID:** 7-byte identifier burned at manufacture. Cannot be cloned. Validated server-side on every tap combined with the device code. Neither alone is sufficient.

**Write tooling:** NFC Tools (wakdev) — iOS or Android. Free. Write takes ~2 seconds.  
**Locking:** Lock the chip after setup is confirmed stable. Domain indirection means the chip never needs rewriting even if the app changes.

### NFC stub (dev only)

Until chips arrive, all tap events are simulated via:

- `GET /api/dev/tap?d=[device-code]&uid=[simulated-uid]` — fires the tap flow programmatically
- `http://localhost:3000/stub` — browser UI with four scenario buttons

The stub is gated behind `ENABLE_STUB=true`. It is never present in production.

---

## Security model

Three items are non-negotiable before any production use:

1. **UID + device code dual validation** — both must be checked together server-side on every tap. The device code is readable by anyone with an NFC reader app. The UID cannot be cloned. Together they are strong.
2. **HttpOnly cookies** — session tokens are never in localStorage. Not accessible to JavaScript.
3. **Server-side lockout** — 5 failed challenge attempts triggers a 30-minute lockout stored in the database. Cannot be cleared client-side.

### Threat model

| Threat | Mitigation |
|---|---|
| Curious stranger taps | Device recognition — unknown device goes straight to contact card, no challenge offered |
| Phone theft — active session | Short session windows. Phone OS lock is first line of defence. |
| Coercion | Danger word authenticates normally, opens shell EA, fires silent alert to trusted contact |
| URL cloning | UID cannot be cloned. UID + device code dual validation rejects requests from different hardware. |
| PIN brute force | 5 attempts then 30-min server-side lockout. Cannot be cleared client-side. |
| Ownership transfer | Device code decommissioned server-side. UID re-registered to new owner via authorised onboarding flow. |

---

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Identity + gateway. Auth. EA chat. Config app. NFC stub. | 🔨 In progress |
| 2 | Manual chain builder. OS delegation. Action log. | Not started |
| 3 | Pattern detection. Proactive suggestions. | Not started |
| 4 | Autonomous execution (per-chain opt-in). | Not started |

---

## Owner

Marco Rota — built for personal use first, potential productisation later.
