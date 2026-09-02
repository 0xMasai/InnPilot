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

## Phase 2

Delivered — see `docs/webmcp/PHASE_2_TOOLS.md`. The embedded reservation and
room handlers were extracted into `src/lib/` services, the UI was repointed
at them, and eight tools now sit on top. Folio and payments remain
unimplemented and therefore have no tools.
