# Phase 8 — Ask InnPilot UI

The agent had no surface in the product until now. Phases 2–7 built a
gateway, ten tools, a permission guard and a system prompt that nothing in
`src/` ever called — `grep -r "api/ai-chat" src/` returned nothing. This
phase connects them, and adds no capability of its own.

## Files

| File | Purpose |
| --- | --- |
| `src/lib/aiClient.ts` | Authenticated POST to the gateway; typed result or `AiClientError`. |
| `src/pages/pms/AskInnPilot.tsx` | The chat surface. |
| `src/App.tsx` | Route `/dashboard/ask`, inside the existing `ProtectedRoute`. |
| `src/dashboard.tsx` | Sidebar entry under Operations, and its `pageMeta`. |

## The client owns no rules

`aiClient.ts` puts a request on the wire and types the response. It holds no
prompt text, no tool list, no retry policy and no interpretation of a reply.
Everything that decides an answer stays in `server/ai/`, which is the whole
point of centralising the prompt in Phase 7 — a second opinion living in the
browser is how those two drift apart.

Two things it does decide, both transport-level:

- **The ID token is fetched per call, never cached.** Firebase's
  `getIdToken()` already returns its cached token until close to expiry, so
  caching again here would only add a way to send a stale one.
- **An error body that is not JSON becomes a generic sentence.** The gateway
  returns `{error}` by contract, but a proxy or a crashed function can return
  HTML with a 502; the fallback keeps a stray `<!DOCTYPE html>` out of the
  transcript.

`AgentResponse` and `ToolCallRecord` are duplicated from `server/ai/types.ts`
rather than imported: `tsconfig.app.json`'s `include` is `["src"]`, so the
browser build cannot reach the server tree. Same arrangement, and the same
reason, as `Role` in that file — and the same obligation to keep them in step.

## What the UI shows

The brief asks for user message, AI response, tool activity, and the
loading / error / confirmation / success states.

- **Tool activity is shown, not hidden.** Each call renders as a collapsed
  row — name, status badge, duration — expanding to the arguments and the
  result. The arguments displayed are the *validated* ones the server ran
  with, not what the model first proposed, so what is on screen is what
  touched the data. This is the feature that makes the agent auditable by
  eye: a manager can see a figure came from `get_revenue` in 214ms rather
  than from the model's memory. Phase 6's `reusedEarlierResult` gets its own
  marker, so a suppressed duplicate is visible as one rather than silently
  disappearing.
- **A failed turn stays in the transcript** as an error entry carrying the
  question, with a retry that does not require retyping. A toast would hide
  which question failed.
- **The composer is Enter-to-send, Shift+Enter for a newline.**
- **One turn in flight at a time**, aborted on unmount, so a reply never
  lands on a component that is gone.
- **An account with no hotel is told so once**, rather than having every
  question fail with the same 403.

## The confirmation panel is real but unreachable

`AgentResponse.pendingConfirmation` is rendered from the gateway's own field,
never inferred from the reply text — the model cannot talk its way into a
confirmation panel by describing one.

**No registered tool can produce one today.** Every Phase 4 tool is read-only
(`isWrite: false`), the orchestrator never sets `pendingConfirmation`, and
there is no confirm route on the gateway to accept the answer. So the panel
renders the summary and disables its Confirm button with a plain statement
that write actions are not enabled in this build, rather than offering a
control that would do nothing. Phase 10 adds the write tools and the route;
this panel is what they will light up.

That means the demo in the brief's definition of done — "Mark Room 204 as
dirty" → confirm → the room changes — **still cannot be performed.** Phase 8
did not change that, and nothing here pretends otherwise.

## Local development cannot reach the agent by default

`vite dev` serves `src/` and runs nothing in `api/`, so the same-origin
`/api/ai-chat` the client posts to does not exist locally. `VITE_AI_API_BASE`
(documented in `.env.example`) points the UI at a deployment or a
`vercel dev` server; doing so makes the request cross-origin, so that origin
must also appear in the gateway's `ALLOWED_ORIGINS`.

Left as configuration rather than solved: the alternative is a dev proxy in
`vite.config.ts` that would need the gateway's credentials in the browser
process, which is worse.

## Validation

- `npx tsc -b` clean; `npx eslint` clean on both new files and on the two
  modified ones (`dashboard.tsx`'s five pre-existing `no-explicit-any` errors
  are unchanged in count and identical in kind).
- `npm run build` succeeds.
- The dev server boots and `/login` renders with **no console errors**, which
  exercises the whole import graph — `App.tsx` imports `AskInnPilot`
  eagerly, so an import-time fault in it or in `aiClient.ts` would fail the
  page. `/dashboard/ask` redirects to `/login` when signed out, confirming
  the route is registered behind `ProtectedRoute`.

## Not verified

**The page has never been rendered signed in.** Doing so needs real
credentials for the live Firebase project, which this session does not have.
Everything past the auth gate — the transcript, the tool-activity rows
against a real `toolCalls` array, the loading and error states, the layout at
`h-[calc(100vh-9rem)]` inside the dashboard shell — is unexercised and should
be walked through by hand before it is shown to anyone.

There are no tests for this phase. The existing suite is Node-based
(`vitest.config.ts` is deliberately separate from the app's Vite config, for
emulator tests); there is no React test setup, no jsdom and no testing-library
in `package.json`, and adding that toolchain is its own piece of work rather
than something to slip into a UI phase. `aiClient.ts` is the part worth
covering first when it is added — it is pure transport, and its error mapping
is the logic most likely to regress.
