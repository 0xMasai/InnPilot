# WebMCP — Phase 2: Service extraction & tools

Phase 2 exposes InnPilot's read and write capabilities to agents. It builds
directly on the Phase 1 foundation (`docs/webmcp/PHASE_1_FOUNDATION.md`);
nothing in `registry.ts`'s design changed.

## The problem Phase 1 identified

InnPilot had a pure domain layer (`lib/pms.ts`, `lib/metrics.ts`) but **no
data-access service layer** — reservation and room writes lived inside React
event handlers. A WebMCP tool cannot call a component handler, so exposing
those capabilities without duplicating their rules required extracting them
first.

## Services extracted

Behaviour, validation order and user-facing wording were preserved exactly;
the UI was repointed at the extracted functions and does the same work it
did before.

| Service | Extracted from | Provides |
| --- | --- | --- |
| `src/lib/reservationService.ts` | `pages/pms/Reservations.tsx` | `createReservation`, `updateReservationStatus`, `loadReservationContext`, `makeReservationNumber` |
| `src/lib/roomService.ts` | `Accommodation.tsx` | `addRoom`, `setRoomStatus`, `loadRooms` |
| `src/lib/reportingData.ts` | `Overview.tsx` / `Reports.tsx` | `loadMetricsInput` — one-shot read of the six collections the dashboards subscribe to |
| `src/lib/serviceResult.ts` | — | `ServiceResult<T>` plus the Firestore error-to-message mapping the UI used inline |

`bookableRooms()` moved into `lib/pms.ts`, where the other pure rules live,
so it is testable without pulling in Firebase.

### Why services return results instead of throwing

A service is called both by a React handler that renders `error` and by a
tool that returns it to an agent. A `ServiceResult` keeps one code path and
one set of wording for both.

### Conflict data is injected, not fetched

`createReservation` takes a `ReservationContext` rather than loading one.
The UI passes its live `onSnapshot` state — so creating a reservation from
the UI still costs no extra reads, exactly as before — while tools call
`loadReservationContext()` first, since an agent has no snapshot.

## Tools

`src/webmcp/tools/`, listed in its `index.ts`.

**Read:** `innpilot_list_rooms`, `innpilot_list_reservations`,
`innpilot_check_room_availability`, `innpilot_get_occupancy`,
`innpilot_get_revenue`.

**Write:** `innpilot_create_reservation`,
`innpilot_update_reservation_status`, `innpilot_set_room_status`.

Notes on behaviour:

- **Availability uses the booking rule.** `innpilot_check_room_availability`
  calls the same `bookingOverlaps()` that guards creation, over both
  `reservations` and legacy `accomodation`, so a room it reports as free is
  one `innpilot_create_reservation` will accept.
- **Occupancy and revenue use `computeMetrics()`** — the dashboards' own
  function — so an agent and the UI cannot report different figures.
- **Ambiguity is refused, not guessed.** When a reservation reference
  matches more than one record, the tool lists the candidates and makes no
  change.
- **Agent writes are audited.** The tools call `logAction()` with an
  "(agent)" marker. The UI does not audit these two reservation operations
  today and extraction deliberately did not change that; auditing was added
  at the tool layer because an agent-initiated change should always be
  attributable.
- **Argument errors go back verbatim.** `toolInput.ts` helpers raise
  `ToolInputError`; the registry returns the message unwrapped so the agent
  can correct the call.

## Not implemented

**Folio charges and payments.** Firestore rules and TypeScript types exist
for `folioItems` and `payments`, but InnPilot has no service, no UI and no
write path for either. Building money-handling business logic is a product
feature rather than part of the WebMCP integration, so no tool was exposed.
Whoever picks that up should build the service first and then add a tool
over it, the same way this phase did.

## Verification

- `tsc -b`, production build, and the existing test suite all pass;
  repo-wide lint errors went **down** (51 → 49) because two `catch (e: any)`
  blocks were replaced by service calls.
- `tests/webmcp-tools.test.ts` covers argument parsing and the bookable-room
  filter.
- Exercised in real Chromium: with a WebMCP implementation present, six
  identical `syncWebMCP` calls register the eight tools exactly once; every
  schema is a well-formed object schema; bad arguments, a missing hotel and
  a signed-out session are each refused with `isError: true` and no
  exception.
