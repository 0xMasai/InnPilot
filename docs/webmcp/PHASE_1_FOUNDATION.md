# WebMCP — Phase 1: Audit & Foundation

Phase 1 lands the WebMCP integration layer only. **No business tools are
exposed yet** — `INNPILOT_WEBMCP_TOOLS` ships empty on purpose.

## Target architecture

```
ChatGPT / compatible agent
          ↓
       WebMCP
          ↓
document.modelContext
          ↓
InnPilot Web App          ← src/webmcp/ (this phase)
          ↓
Existing business services
          ↓
Firebase Auth + Firestore
```

## What was verified about the WebMCP API

Checked against the W3C Web Machine Learning CG proposal and Chrome's
developer guidance rather than assumed:

- The imperative API is **`document.modelContext`**. `navigator.modelContext`
  was the original location and is **deprecated in Chromium 150+**; the
  recommended detection checks `document` first and falls back to
  `navigator`. Both are handled in `registry.ts`.
- `registerTool(descriptor, { signal })` is **async** and takes an
  `AbortSignal`. Aborting the signal is the spec's teardown path — there
  is no reliable `unregisterTool()` to depend on, so lifecycle is managed
  entirely through `AbortController`.
- A tool descriptor is `{ name, description, inputSchema, execute }`, where
  `inputSchema` is a JSON Schema object.
- `execute` returns `{ content: [{ type: "text", text }] }`, optionally with
  `isError: true` to report failure without throwing.
- Registering a duplicate tool name throws `InvalidStateError`.
- **WebMCP requires a secure context (HTTPS).** It is unavailable over
  plain HTTP, including some local dev setups.

No npm package is required — this is a browser API, so Phase 1 added
**zero dependencies**.

## Files

| File | Purpose |
| --- | --- |
| `src/types/webmcp.d.ts` | Minimal ambient types for the browser API. Declares `document.modelContext` / `navigator.modelContext` as **optional**, which forces every call site through a feature check. |
| `src/webmcp/registry.ts` | Feature detection, one-time registration per session, `AbortController` lifecycle, and the auth/role/tenant guard. |
| `src/webmcp/tools.ts` | The toolset and its contract. Empty in Phase 1; the single place Phase 2 adds tools. |
| `src/webmcp/WebMCPProvider.tsx` | Binds `AuthProvider` state to the registry. Renders no DOM. |

## How the foundation behaves

- **Unsupported browsers** — `getWebMCPStatus()` returns
  `{ supported: false, reason }`, where `reason` distinguishes
  `no-document` (not a browser), `insecure-context` (not HTTPS) and
  `api-unavailable` (browser has no implementation). Every entry point is
  a no-op; nothing throws.
- **No re-registration on re-render** — `syncWebMCP()` compares an identity
  key (`uid | role | hotelId`) and returns early when unchanged, so React
  render churn never reaches the browser API.
- **Auth is re-checked at invoke time, not registration time** — tools read
  live auth state, so a sign-out or role change takes effect on the next
  call.
- **Tenant safety** — a tool only runs with a non-null `hotelId`, which is
  what `hotelCollection()` / `hotelDoc()` need. `super_admin` (whose
  `hotelId` is always null) is refused by default, matching the fact that
  they operate the platform rather than a hotel.
- **RBAC matches the UI** — default allowed roles are
  `["hotel_admin", "staff"]`, the same default as `ProtectedRoute`, so an
  agent can never reach an operation the same user couldn't reach by hand.

## Phase 2: existing services to reuse

Phase 2 tools must call these; they must **not** re-implement rules or
write to Firestore directly.

> **Important audit finding.** InnPilot has a **pure domain layer**
> (`src/lib/pms.ts`, `src/lib/metrics.ts`) but **no data-access service
> layer**. Reservation and room writes live inside React components. Phase 2
> must therefore *extract* those handlers into callable services first, and
> have both the UI and the WebMCP tools call the extracted function — that
> is the only way to satisfy "do not duplicate business logic".

| Capability | Existing code to reuse | State |
| --- | --- | --- |
| **Room availability** | `bookingOverlaps(roomNumber, checkIn, checkOut, bookings)` and `operationalStatus(room)` — `src/lib/pms.ts`. Inventory read: `hotelCollection(hotelId, COLLECTIONS.ROOMS)`. Note `Reservations.tsx` checks **both** `RESERVATIONS` and legacy `BOOKINGS` (`accomodation`) so migration can't cause a double booking — tools must do the same. | ✅ Pure and reusable as-is |
| **Reservation creation** | `createReservation()` — `src/pages/pms/Reservations.tsx`. Owns validation, the 14:00/11:00 check-in/out convention, conflict detection, rate/total calculation via `bookingDays()`, and the `addDoc` write. | ⚠️ Embedded in the component — extract first |
| **Reservation modification** | `updateReservationStatus(booking, status)` — `src/pages/pms/Reservations.tsx`. Legacy equivalent in `src/Accommodation.tsx`. | ⚠️ Embedded in the component — extract first |
| **Room operations** | Add room and room-status change handlers — `src/Accommodation.tsx` (`updateDoc` on `COLLECTIONS.ROOMS` + `logAction`). | ⚠️ Embedded in the component — extract first |
| **Folio charges** | **Not implemented.** `COLLECTIONS.FOLIO_ITEMS` and the `FolioItem` type (`src/types/pms.ts`) exist, but nothing reads or writes them. | ❌ Must be built before a tool can wrap it |
| **Payments** | **Not implemented.** `COLLECTIONS.PAYMENTS`, `Payment`, `PaymentMethod`, `PaymentStatus` (`src/types/pms.ts`) exist, but nothing reads or writes them. | ❌ Must be built before a tool can wrap it |
| **Occupancy** | `occupancyRate(occupied, total)` — `src/lib/pms.ts`; `computeMetrics(input, range).occupancy` → `{ totalRooms, occupied, available, rate }` — `src/lib/metrics.ts`. | ✅ Pure and reusable as-is |
| **Revenue** | `computeMetrics(input, range)` — `src/lib/metrics.ts`, returning `accommodationRevenue`, `restaurantRevenue`, `conferenceRevenue`, `totalRevenue`, `totalExpenses`, `netOperatingResult`, `pendingPayments`. Ranges via `getRange(preset)` / `customRange(start, end)`; trends via `dailySeries()`. | ✅ Pure and reusable as-is |

Supporting pieces every write tool should use:

- `logAction(hotelId, action, entity, entityId, details)` — `src/lib/audit.ts`.
  Fire-and-forget append-only audit trail. Agent-initiated writes should be
  auditable exactly like UI-initiated ones.
- `hotelCollection()` / `hotelDoc()` / `hotelDocRef()` — `src/lib/hotelScope.ts`.
  The tenant boundary; Firestore rules key off the `{hotelId}` path segment.
- `COLLECTIONS` — `src/lib/collections.ts`. Single source of truth for names.

## Relationship to `functions/src/ai/`

The repository contains an earlier, separate experiment: a Firebase Cloud
Functions AI agent (gateway, orchestrator, its own `toolRegistry.ts`).
**That is a different architecture and Phase 1 does not build on it, extend
it, or remove it.** WebMCP needs no server: the browser exposes the tools
and they run in the page against the already-authenticated Firebase
session. Note that `functions/src/ai/toolRegistry.ts` also exports a
`registerTool`; it is unrelated to the WebMCP browser API.

## Phase 2

1. Extract the embedded reservation/room handlers into real services under
   `src/lib/`, and repoint the existing UI at them (no behaviour change).
2. Add read-only tools first (occupancy, revenue, availability), since they
   reuse the pure functions and need no extraction.
3. Add write tools (create/modify reservation, room status) on top of the
   extracted services, each calling `logAction`.
4. Build folio and payments services before exposing tools for them.
5. Register each tool by pushing it into `INNPILOT_WEBMCP_TOOLS` in
   `src/webmcp/tools.ts` — no changes to `registry.ts` are needed.
