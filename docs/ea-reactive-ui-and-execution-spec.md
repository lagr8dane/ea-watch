# EA — reactive UI & execution (working spec)

**Status:** Active — Phase 1 shipped; Phase 2 (pending handoff API + EA banner) shipped.  
**Scope:** Single web app; **no separate mobile/desktop products**. **No device-detection routing** for flows — only **layout, density, and ergonomics** adapt.

---

## 1. Reactive UI (same functionality everywhere)

### Principle

- **One surface (`/ea`), one feature set.** Phone, iPad, and laptop differ only in **how** the UI presents (spacing, max width, tap targets, optional keyboard affordances).
- **No** branching product logic on `userAgent` or viewport for *what* the user can do.

### Phase 1 — UI (`public/shell.css` + pages)

**Global:** `public/shell.css` defines `.app-shell` and `body.has-app-shell` for **all** primary pages (EA, config, tasks, chains, log, radar, challenge, stub, privacy, terms, contact). Default **`--shell-max-width: 640px`**; override with `html[data-shell-max="720"]` / `560` or `html style="--shell-max-width: 680px"`.

**`public/legal-footer.js` (v3):** One **Privacy · Terms** strip, mounted **inside `.app-shell`** (after `.input-bar` on `/ea`, else bottom of shell). Contact card keeps `data-no-global-legal` and its own footer.

| # | Item | Notes |
|---|------|--------|
| R1 | **Centered reading column** | Shared shell; side borders from 560px viewport. |
| R2 | **Safe area insets** | EA header/messages/input; legal strip; centered shells. |
| R3 | **Minimum tap targets** | EA: 44px controls (see `ea.html`). |
| R4 | **Responsive padding** | EA messages/input; per-page tweaks. |
| R5 | **`prefers-reduced-motion`** | EA typing / voice. |
| R6 | **`:focus-visible`** | EA primary controls. |

### Explicit non-goals (UI)

- No separate “desktop EA.”  
- No dashboard / inbox / calendar UI here.  
- OS deeplinks may **behave differently** by environment (e.g. Spotify on laptop vs phone) — document in copy, don’t hide the control.

### Open questions (answer when ready)

1. ~~Shell on all main pages~~ — Done via `shell.css` + `shell-pref.js`. **Reading width** is configurable per browser under **Settings → Display** (localStorage `ea_shell_max`).  
2. Do we want **optional** “larger text” (accessibility) via a query param or Settings later?

---

## 2. Execution surface & routines (product rules — later phases)

*Deferred to backend + small UI prompts; listed so UI doesn’t paint us into a corner.*

### Routine / step classification (deterministic)

- **`environment_agnostic`** — Tasks, panels, server-backed actions; safe on any browser.  
- **`requires_phone_os`** (name TBD) — Deeplinks / Shortcuts / Maps / Clock / “hike”-style flows that assume **pocket phone + OS apps**.

### When the current device cannot run

1. **Do not** half-execute OS-bound steps on laptop.  
2. **Cache a pending command** on the server (`owner_id`, small payload, **target surface**, TTL e.g. 10–15 min).  
3. **Instruct** user to open EA on the target device — **no requirement** for a pre-existing “active session”; opening EA is enough.  
4. On load, EA fetches pending → **one confirmation** → run.

### Spotify / “play X”

Same pattern possible: **queue + open on phone + confirm**, or **server Spotify API** to target a device when available — product chooses per path; UI only needs **clear choices** and **non-deceptive copy**.

---

## 3. Phased backlog (implementation order)

| Phase | Focus | Deliverables |
|-------|--------|----------------|
| **1** | Reactive UI | `shell.css` + `ea.html` ergonomics (R1–R6). |
| **2** | Pending command API + EA banner | `GET/POST/DELETE /api/pending-command`; Turso `pending_commands`; EA bar (Continue / Dismiss). Run `scripts/db-migrate-pending-command.js`. |
| **3** | Routine surface tags | Schema / metadata on chains or steps; router before execute; auto-`POST` pending when wrong surface. |
| **4** | Presence (optional) | Heartbeat for “EA open elsewhere” — **not** required for pending flow. |

---

## 4. Related docs

- `docs/temporal-travel-companion-spec.md` — separate travel module; shared auth ideas only.  
- `HANDOFF.md` — current shipped EA behavior.
