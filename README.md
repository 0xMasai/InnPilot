# InnPilot — a hotel PMS that speaks WebMCP

**Live demo:** https://hotel-ms-six.vercel.app
**Submission:** OpenAI WebMCP Challenge

InnPilot is a working property-management system for independent hotels —
reservations, rooms, occupancy, revenue, restaurant, conference and expenses,
multi-tenant and role-aware. For this challenge it does one thing most PMSs
cannot: **it registers its real operating capabilities as WebMCP tools**, so an
AI agent visiting the site can discover and use them directly instead of
scraping the UI.

```
External agent → document.modelContext → InnPilot WebMCP tools → InnPilot services → Firebase
```

---

## Why WebMCP matters here

A hotel manager already has a dashboard. The question this submission answers is:
**what gets better when an AI agent can operate on the same hotel, through the
same rules, at the same time?**

Without WebMCP, an agent has to drive InnPilot's screens blindly — guessing at
buttons, parsing rendered tables. With WebMCP, the agent calls
`innpilot_check_room_availability` and gets **structured, authoritative data**
from the exact function the booking screen uses. The agent and the human share
one source of truth, one set of permissions, and one audit trail.

Crucially, the tools run **inside the manager's already-authenticated session**.
The agent inherits the signed-in user's hotel and role — it can never see another
hotel's data or do anything the user couldn't do by hand.

---

## What an agent can do — the 8 tools

Registered on `document.modelContext` for the signed-in session (`src/webmcp/tools/`):

**Read**

| Tool | What it returns |
| --- | --- |
| `innpilot_list_rooms` | Room inventory: number, type, nightly rate, housekeeping status. |
| `innpilot_list_reservations` | Current reservations, optionally filtered by status. |
| `innpilot_check_room_availability` | Rooms free for a stay, using the exact conflict rule that guards booking. |
| `innpilot_get_occupancy` | Occupancy rate, occupied/available counts. |
| `innpilot_get_revenue` | Revenue by department, expenses, net operating result. |

**Write** (each runs the same validated service the UI uses, and is written to the audit log as an agent action)

| Tool | What it does |
| --- | --- |
| `innpilot_create_reservation` | Creates a confirmed reservation (rejects conflicts/maintenance). |
| `innpilot_update_reservation_status` | Check in / out, cancel, mark no-show. |
| `innpilot_set_room_status` | Set housekeeping / maintenance status. |

Every tool re-checks authentication, role (`hotel_admin` / `staff`) and hotel
tenant **on every call** — not at registration time — so a sign-out or role
change takes effect immediately.

---

## How to test it as a judge

You do **not** need the source code to try this.

### 1. Open InnPilot in a WebMCP-capable browser
WebMCP requires HTTPS (InnPilot is served over HTTPS) and a browser that
implements `document.modelContext`:
- **ChatGPT's in-app browser**, or
- **Chrome 149+ with WebMCP enabled** (`chrome://flags` → enable the Web Model
  Context / WebMCP flag).

In an ordinary browser the tools simply don't register — that's the spec's
required fail-safe, not a bug. The dashboard header shows a **WebMCP status
badge** so you can see immediately whether tools are live.

### 2. Sign in first (this is required)
Tools register **only for a signed-in session**. Use the demo account:

- **URL:** https://hotel-ms-six.vercel.app
- **Button:** "Sign in with Demo Admin" (or email `felixm@innpilot.com`, password `0777429854`)
- This is a `hotel_admin` of a seeded demo hotel with real rooms, reservations and revenue.

After sign-in, the header badge should read **"WebMCP · 8 tools"**.

### 3. Let an agent discover and invoke the tools
With the agent attached to the tab, try prompts like:

- *"Which rooms are available tomorrow night?"* → agent calls `innpilot_check_room_availability`.
- *"What's our occupancy right now?"* → `innpilot_get_occupancy`.
- *"How much revenue did we make, broken down by department?"* → `innpilot_get_revenue`.
- *"List every room that's currently marked for cleaning."* → `innpilot_list_rooms`.

**Optional write demo:** *"Mark room 101 as cleaning."* → `innpilot_set_room_status`.
Then open the dashboard — the room's status has changed, and the **Audit Log**
(Administration → Audit Log) records it as an agent action.

### What you should expect
Structured text results the agent can reason over, tenant-scoped to the demo
hotel, with clean, human-readable errors (e.g. "No room numbered 999") rather
than stack traces. The InnPilot UI reflects any write the agent makes, live.

---

## Two AI experiences — don't conflate them

InnPilot has **two** separate AI surfaces. For this challenge, **WebMCP is the
hero**:

- **WebMCP (the submission):** `external agent → document.modelContext →
  InnPilot tools → services → Firebase`. No server, no bundled chatbot — the
  browser hosts the tools and an *external* agent calls them.
- **Ask InnPilot (a separate product feature):** an in-app assistant backed by
  InnPilot's own server-side AI gateway (`user → Ask InnPilot → /api/ai-chat →
  tools → Firebase`). It's a nice part of the product, but it is **not** the
  WebMCP feature and isn't required to judge this submission.

---

## How WebMCP is implemented

| File | Purpose |
| --- | --- |
| `src/types/webmcp.d.ts` | Minimal local types for the API (WebMCP ships none). |
| `src/webmcp/registry.ts` | Feature detection, registration lifecycle (`AbortController`), and the auth/role/tenant guard applied to every call. |
| `src/webmcp/tools/` | The eight tools; listed in `tools/index.ts`. |
| `src/webmcp/WebMCPProvider.tsx` | Binds the signed-in session to the registry; rendered inside `AuthProvider`. |
| `src/webmcp/WebMCPStatusBadge.tsx` | The honest "WebMCP · N tools" header badge. |

Design guarantees (see `docs/webmcp/`):
- **Feature-detected & fail-safe** — resolves `document.modelContext`, falls back
  to the deprecated `navigator.modelContext`; unsupported browsers are a silent no-op.
- **No duplicated business logic** — tools call the same `src/lib/` services the
  UI uses (`reservationService`, `roomService`, `metrics`), so an agent and the
  screen can never disagree.
- **Idempotent registration** — keyed on `uid | role | hotelId`; React
  re-renders never re-register anything.
- **Tenant-isolated** — enforced both in the registry guard and in
  `firestore.rules` (the server-side boundary), so isolation doesn't depend on
  client good behaviour.

---

## Run it locally

```bash
npm install
cp .env.example .env      # fill in your own Firebase + (optional) AI values
npm run dev               # Vite dev server
```

> **WebMCP needs HTTPS.** `vite dev` on plain `http://localhost` is not a secure
> context, so `document.modelContext` won't be present locally. Test WebMCP
> against the deployed HTTPS URL, or a local HTTPS/tunnel setup.

**Build & tests**

```bash
npm run build       # tsc -b && vite build
npm run test:ai     # AI gateway + tool tests (no emulator needed)
npm run test:rules  # Firestore security-rules tests (needs the emulator)
npm run test:all    # everything, emulator started for you
```

**Environment** — see `.env.example`. Frontend `VITE_*` values are public; the
AI key, Firebase service account, and `ALLOWED_ORIGINS` are server-side only and
live in the host's secret store (Vercel env vars), never in the repo.
`ALLOWED_ORIGINS` and `VITE_AI_API_BASE` must have **no trailing slash**.

---

## Architecture at a glance

- **Frontend:** React 19 + Vite + Tailwind, deployed on Vercel.
- **Data & auth:** Firebase Auth + Firestore, multi-tenant under
  `hotels/{hotelId}/…`, with roles `super_admin` / `hotel_admin` / `staff` /
  `pending`.
- **WebMCP:** browser-hosted tools over `document.modelContext` (this submission).
- **Ask InnPilot (separate):** a Vercel serverless AI gateway at `/api/ai-chat`.

Everything the agent touches goes through the same services, rules and audit
trail as the human — which is the whole point.
