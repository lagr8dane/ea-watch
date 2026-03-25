# Temporal Travel Companion — working spec

**Status:** Draft (working document)  
**Purpose:** Capture product intent, architecture direction, open questions, and risks from design discussions. Not a commitment to build order or scope.

---

## 1. Product vision

A **Temporal Travel Companion**: structured trip planning that persists **server-side**, works **across devices**, can be opened via **NFC tap**, and uses **AI sparingly** to suggest and summarize — while **structured Trip State** remains the **source of truth** (not chat logs).

**Working name:** Temporal Travel Companion (internal). May ship under a different product name.

**Relationship to EA Watch:** This spec can be a **module** inside the existing app (same `owner_id`, sessions, devices) or a **sibling surface** with shared auth. Integration points are noted; final bundling TBD.

---

## 2. Core principles

| Principle | Meaning |
|-----------|---------|
| **Structured state is truth** | Itinerary, decisions, lists, and open loops live in DB-backed models; AI proposes patches, not authoritative narrative. |
| **Minimal, targeted AI** | Trigger on user action or explicit “refresh summary” / “suggest”; not on every navigation or keystroke. |
| **Mobile web-first** | Fast, touch-first UI; no requirement for native apps in v1. |
| **Bounded AI context** | Inputs: Trip State subset + rolling **`summary`** + current user message (optional: last **2–3** turns for tone). **Not** full chat history. |
| **Separation of concerns** | Fixed vs flexible; considering vs decided vs booked; planned vs open (research/decision). |

---

## 3. User capabilities (target)

- Create a **trip** (destination, dates, party, type).
- **Structured intake:** anchors (hotel, meetings, key locations), constraints (pace, budget band, style), opportunity areas (meals, activities, downtime), **open loops** (research later).
- **Search & save:** places (and **non-POI** items: events, links, ideas — title, URL, summary; **may lack lat/lon**).
- **Organize:** days and/or lists; optional **trip-scoped lists** (e.g. “London — summer 2025”) with **append** and **dedupe** (e.g. by URL / external place id).
- **Decisions:** items move **considering → decided → booked** (or equivalent).
- **Daily view** of the itinerary.
- **Context when traveling:** e.g. **“near you”** using device location vs saved items that have coordinates; **chips** or banners (“Open your London list”).
- **NFC tap:** opens **active trip** with **today’s focus**, nearby saved items (where coords exist), open loops/tasks.
- **Optional:** **Google Calendar** export or one-way sync for **booked/decided** blocks; **read busy** later for smarter planning.

---

## 4. Architecture notes (high level)

### 4.1 Trip State + summary

- Persist an evolving **structured blob** (normalized tables + JSON where appropriate) plus a short **AI-generated `summary`** (capped length).
- On each AI call, send **structured state + summary + user message** (optional short turn buffer).
- Regenerate **summary** only when state changes meaningfully (diff/hash), not every request.

### 4.2 Chat / planner surface

- **Recommended:** Dedicated **nav entry** (not only generic EA chat) so users expect **persistence** and **trip context**.
- **Optional** “planner thread”: if present, still **persist Trip State** as truth; transcript is **not** the system of record.
- **Vanilla EA** (`/ea`) may remain **light** (ephemeral in-tab history) unless product chooses otherwise.

### 4.3 Interest Radar / discovery alignment

- Today, radar results on **`/interest-radar`** live in **memory** (`lastRadarItems`); **sessionStorage** only caches **`ea_location`**. Leaving the page or switching devices **drops** result cards (tasks copied to `/api/tasks` excepted).
- **Direction:** **Server-side history** and/or **trip lists** so runs and saved cards **survive** navigation and device switches.
- **Cache / cost:** Reuse **recent searches “near here”** with **TTL** and **“Refresh for latest”** to reduce **Google Places** and **Claude (Ideas)** cost; label stale results clearly. Payload sizes for stored runs are **modest** (~KB–tens of KB per run).

### 4.4 Multi-device & sessions (EA Watch today)

- **Settings & integrations** (e.g. future Spotify, Calendar) should be **owner-scoped**; any device with a valid session for that owner sees the same config.
- **Tap gateway:** Session should validate **same `owner_id` as tapped device**, not necessarily **same `device_id`** as when the session was created — so **multiple watches** on one account work without re-auth per watch.
- **Device registration:** New devices should attach to **authenticated `owner_id`**, not arbitrary `LIMIT 1` on `owner_config`.
- **Chat history** on generic EA: still **ephemeral per tab** unless planner mode stores messages separately.

### 4.5 NFC

- Requires a clear **active trip** concept: e.g. **`active_trip_id`** (or user preference) so tap resolves **which** trip to open when multiple exist.

### 4.6 Proposed data model (draft — engineering to refine)

**Trip**

- `id`, `user_id` / `owner_id`
- `title`, destination / location fields
- `start_date`, `end_date`, `timezone`
- `constraints` (JSON)
- `summary` (AI, capped)
- `readiness_score` — **open:** define formula or **defer to V2**
- `updated_at`
- **Active trip:** `active_trip_id` on user prefs **or** flag on trip — **to resolve**

**TripDay**

- `id`, `trip_id`, `date`, `sort_order`
- Items linked by FK (not only nested JSON)

**TripItem**

- `id`, `trip_id`, `trip_day_id` (nullable for unscheduled lists)
- `type`: `place | note | reservation | task | event_link | …`
- `status`: `considering | decided | booked`
- `place_id` → **Place** (nullable)
- `lat`, `lng` (nullable)
- `time_block` (optional)
- `metadata` (JSON), `sort_order`

**Place**

- `id`, `external_id` (Google / etc.), `name`, `lat`, `lng`, `cached_metadata` (JSON), `fetched_at`

**OpenLoop** (or merged with tasks — **see open issues**)

- `id`, `trip_id`, `description`, `status`, `linked_trip_item_id` (optional)

**Integration:** Reuse existing **`tasks`** with metadata (`trip_id`, `source: trip`) **or** keep research items only in trip blob — **to resolve**.

---

## 5. AI integration (constraints)

| Do | Don’t |
|----|--------|
| Suggest structured candidates; user accepts/rejects | Let prose replace entire trip without validation |
| Output **JSON patches / tool calls** against Trip State | Rely on **full chat history** for truth |
| Regenerate **summary** on meaningful state change | Call model on every page view |
| Cap tokens: state subset + summary + message | Send unbounded history |

**Observability:** Log token usage and external API calls (Places, etc.) per trip/user for cost control.

---

## 6. Integrations (roadmap-friendly)

| Integration | Role | Notes |
|-------------|------|--------|
| **Google Places** (existing radar) | Find places, cache results | TTL + refresh; cost-sensitive |
| **Google Calendar** | Export / busy | OAuth separate from Places; start **one-way** export |
| **Spotify** (existing roadmap) | Owner-level OAuth | Same pattern as Calendar tokens |
| **Maps (basic)** | Pins for items with lat/lon | Lazy load; no advanced routing in MVP |

---

## 7. Segments & positioning

| Segment | Fit |
|---------|-----|
| **Prosumer / traveler** | Primary wedge: NFC + trip persistence + discovery → itinerary |
| **SMB / lower mid-market** | Sweet spot for B2B: offsites, sales teams, lighter procurement than enterprise OBT |
| **Enterprise** | Longer path: SSO, audit, retention, policy, OBT overlap — partner or Phase 2+ |
| **Human assistant / arranger** | Strong story: **arranger** edits Trip State; **traveler** reviews and taps; use vocabulary **arranger / planner** vs **EA** (AI) to avoid naming collision with **EA** the assistant in EA Watch |

---

## 8. Phasing (suggested — not final)

**MVP (illustrative)**

- Trip + intake + Trip State CRUD
- TripItem + considering/decided/booked
- Place search + save to trip (reuse or extend radar APIs)
- Daily view + **active trip** + minimal NFC deep link
- Summary field + **one** AI endpoint (structured suggest / summarize)

**Next**

- History cache / “near you” chips
- Google Calendar export
- Map pins
- Open loops vs tasks clarity + optional sync to global tasks

**Later**

- Human arranger roles, org workspace, SSO
- Routing / day optimization
- Deeper enterprise compliance

---

## 9. Open issues (to resolve)

1. **Active trip:** Single field vs per-device “last opened trip.”
2. **`readiness_score`:** Definition and owner, or drop for v1.
3. **OpenLoop vs `TripItem` type `task`:** Merge with subtypes or separate tables and UX.
4. **Global tasks vs trip-only:** Single `tasks` table with `trip_id` vs trip-embedded only.
5. **Planner chat:** Ship without dedicated thread at first, or include with hard **N**-turn cap?
6. **Naming in UI:** **EA** (AI) vs **human EA** → use **arranger** / **planner** in B2B copy.
7. **Multi-watch + session:** Confirm `tap.js`-style session checks are **owner-scoped**; fix device POST to use session `owner_id`.
8. **Ideas radar items without coordinates:** How **“near you”** and **map** behave (text-only cards OK).
9. **Stale data policy:** TTLs per mode (Places **Tonight** vs **Week**); when to block cache.
10. **Bundling:** This module **inside** EA Watch repo vs separate product — deployment and nav structure.
11. **Privacy / copy:** Explicit disclosure when trip planner **stores** chats (if any) vs **only** Trip State + summary.

---

## 10. Risks

| Risk | Mitigation direction |
|------|----------------------|
| **Scope creep** | Strict MVP; AI only on explicit triggers; defer routing and full calendar sync |
| **Stale recommendations** | TTL, “Refresh,” don’t present cache as live for **open now** |
| **Cost runaway** | Cache Places/Ideas by key + TTL; rate limits; monitor tokens and API calls |
| **Enterprise expectations** | Position SMB first; avoid implying replacement of Concur/Navan without integrations |
| **Data sensitivity** | Itineraries may mention clients/M&A; plan encryption, access control, delete/export |
| **Duplicate calendar events** | Stable external mapping (`event_id` on TripItem) on sync |
| **OAuth sprawl** | Google Calendar + Places + future services — consolidate UX and token storage per `owner_id` |
| **Hallucinated bookings** | AI **suggests**; human marks **booked**; never imply automated booking without integrations |
| **Naming confusion** | **EA** = product AI; human operators = **arranger** / **assistant** in copy |

---

## 11. Document control

- **Maintainer:** Product / engineering lead  
- **Updates:** Revise **Open issues** and **Risks** as decisions land; keep **Phasing** aligned with actual backlog.

---

*End of working spec.*
