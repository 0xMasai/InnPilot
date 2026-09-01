# Phase 3 — AI Provider Abstraction

Phase 2's infrastructure is in place and unchanged in shape; this phase
gives it an LLM, behind an interface, driven entirely by environment
variables. No secrets, model ids, or endpoints are hard-coded anywhere.

## What exists now

```
functions/src/ai/
  provider.ts              # AIProvider interface, config resolution, factory
  providers/
    openai.ts              # the configured default (Responses API)
    anthropic.ts           # second implementation, proves the seam
  orchestrator.ts          # now calls the provider; still no tools
  gateway.ts               # Firebase callable adapter (see hosting note below)
  ../admin.ts              # credentials that work off Google infrastructure
functions/.env.example     # documents every AI_* and credential variable
functions/scripts/smoke.js # `npm run smoke` — verifies credentials end to end
```

### The interface

`AIProvider` is `{ providerName, model, generate(request) }`, exchanging
provider-neutral types (`ProviderMessage`, `ProviderToolSchema`,
`ProviderToolUse`, `ProviderResponse`). Nothing outside `providers/`
imports a vendor SDK, so Phase 4's tools and Phase 6's orchestration loop
are written once, against this interface, not against one vendor.

`ProviderResponse.raw` carries the provider's own assistant content back to
the caller as an opaque value. It exists so Phase 6's tool loop can replay a
turn verbatim to the same provider (some providers require their reasoning
blocks echoed back unmodified) without that requirement leaking into the
orchestrator now. It is never persisted or shown to a user.

### Configuration (all runtime env, no build-time values)

| Variable | Required | Default | Where it lives |
|---|---|---|---|
| `AI_PROVIDER` | no | `openai` | host env |
| `AI_MODEL` | no | provider default (`gpt-5.6`) | host env |
| `AI_MAX_TOKENS` | no | `4096` | host env |
| `AI_EFFORT` | no | `medium` | host env |
| `AI_API_KEY` | **yes** | — | host **secret** store |
| `FIREBASE_SERVICE_ACCOUNT` | off Google infra | ADC | host **secret** store |

Bad values fail loudly at resolution (unknown provider, non-integer token
cap, unknown effort) rather than silently falling back to a default.

## Decisions made while implementing (flagging, not asking permission for)

- **`.env.example` lives at `functions/.env.example`, not the repo root.**
  Phase 1's plan named a root `.env.example`, with the reasoning that these
  are server-side Cloud Functions values and must not carry the `VITE_`
  prefix. `functions/` is where that is literally true: Firebase loads
  `functions/.env` for the deployed function, and a root `.env.example`
  listing `AI_*` alongside the app's `VITE_*` values would invite someone to
  paste an API key into the Vite env — the exact failure Phase 1 was
  guarding against. Root `.gitignore` already ignores `.env` at any depth
  and `*.local`, so `functions/.env` and `functions/.env.local` are covered
  without a change.
- **`AI_API_KEY` is read from `process.env` only.** `gateway.ts` still
  binds it as a Firebase secret (`defineSecret`) for the Cloud Functions
  adapter, but `provider.ts` imports nothing from `firebase-functions`, so
  the same provider code runs unchanged on whichever host the gateway moves
  to, and is testable with a plain env object (Phase 15).
- **Provider chosen: OpenAI (`openai`, Responses API), default model
  `gpt-5.6`** — your call, and the default the abstraction now ships with.
  Anthropic stays registered as a second implementation: it costs one entry
  in the factory map, and it is the evidence that the seam is real rather
  than theoretical. Switching is one env var, no code change.
- **`store: false` on every OpenAI request.** Hotel operational data is not
  retained provider-side; conversation history stays in Firestore, where
  the rest of the app's data already lives.
- **Firebase Admin now accepts a service-account credential from
  `FIREBASE_SERVICE_ACCOUNT`** (raw JSON or base64), falling back to
  Application Default Credentials when it is absent. Required because a
  non-Google host has no metadata server to authenticate against. This
  amends Phase 2's `admin.ts`; flagging it as an amendment rather than
  silently reopening a closed phase.
- **Adaptive thinking + `effort` are on by default** (`AI_EFFORT=medium`),
  because V1's harder questions ("why is revenue lower this week?") are
  analysis over multiple tool results, not lookups. Deployments that want
  cheaper/faster turns set `AI_EFFORT=low`.
- **Server-side refusal fallback is enabled** (`fallbacks: "default"`), so a
  policy refusal is retried on a fallback model inside the same call rather
  than returning nothing. `"default"` means no second model id to maintain.
- **Callable timeout raised to 120s, provider request capped at 60s** with
  one retry, so a slow model surfaces as our own error message instead of an
  opaque function timeout.
- **Orchestrator is now live but still tool-less.** It sends the last 20
  messages of history plus a placeholder system prompt (Phase 7 replaces
  it). Because no tools are registered yet, that prompt explicitly forbids
  stating or estimating any operational, financial, reservation, or guest
  figure and requires the model to say data access isn't connected — the
  brief's "never fabricate data" rule applied to "no tools yet".
- **Every failure path degrades honestly, not silently.** Unconfigured
  provider, misconfiguration, upstream failure, and refusal each return a
  distinct plain-English reply saying no answer is available; none of them
  invents one. Details go to `console.error` (structured logging is
  Phase 13).
- **`ProviderRequestError` does not carry the SDK's error message text**,
  only its type and HTTP status, so a provider error can't echo request
  content (which will contain hotel data from Phase 4 onward) back to the
  client.

## Validation

- `functions`: `npx tsc --noEmit` clean; `npm run build` produces
  `lib/ai/provider.js` plus `lib/ai/providers/{openai,anthropic}.js`.
- Config resolution exercised against the built output: defaults resolve to
  openai/gpt-5.6, `AI_PROVIDER=anthropic` switches implementation,
  `AI_MODEL` overrides the model, plus memoization, cache rebuild on a
  rotated key, and rejection of an unsupported provider, a negative token
  cap, and an unknown effort value.
- Admin credential resolution exercised both ways with a locally generated
  key: raw-JSON and base64 `FIREBASE_SERVICE_ACCOUNT` both initialize
  against project `hotel-management-c183c`; a malformed value is rejected
  with a message that does not echo the key.
- `npm run lint` in `functions/` still cannot run: there is no
  `functions/eslint.config.js`, so ESLint falls back to the root config,
  whose plugins are not installed for this package. Pre-existing from
  Phase 2, not introduced here; worth fixing when the package gets its own
  test/lint setup in Phase 15.
- Root app: untouched. No file outside `functions/` and `docs/ai/` changed.

### Live checks with real credentials

- **Firebase Admin works against the real project.** Using the
  `firebase-adminsdk-fbsvc@hotel-management-c183c` service account, a
  read-only query reached Firestore: `users` and `hotels` are both
  readable, roles come back as the Context Manager expects
  (`super_admin` with no hotel, `staff` with a hotelId), and the project
  currently holds one hotel. Nothing was written.
- **The OpenAI call could not be made from the development sandbox.** Its
  egress proxy refuses `CONNECT api.openai.com` with a 403 — confirmed with
  a dummy token, so it is a network restriction, not a credential problem.
  The key is therefore *unverified*: run `npm run smoke` from a machine with
  open egress to confirm it.
- That block did exercise a failure path for free: the provider mapped the
  403 to `ProviderRequestError(403)` without leaking request content, which
  is exactly what the orchestrator turns into "I couldn't reach the AI
  service just now" rather than a fabricated answer.

### Credentials in this working copy

`functions/.env` (provider config + `AI_API_KEY`) and
`functions/serviceAccountKey.json` exist locally and are **git-ignored** —
confirmed with `git check-ignore`; neither has ever been staged. They are
for local runs only. On the deployed host, the same values go in that
host's secret store, with the service account passed as
`FIREBASE_SERVICE_ACCOUNT` (one-line JSON or base64) rather than a file.

**Both credentials were shared over chat and should be rotated** once the
gateway is deployed and working: a new key in the OpenAI dashboard, and a
new service-account key in the Firebase console (which lets you delete the
old one outright).

## Hosting: the gateway is leaving Cloud Functions

The project stays on the Spark plan, and Cloud Functions cannot deploy
without Blaze — so the `aiChat` callable in `gateway.ts` has no runtime.
Decision taken: the gateway moves to a generic serverless host, keeping the
Admin SDK and the whole Phase 2 module structure, authenticating with the
`firebase-adminsdk-fbsvc@hotel-management-c183c` service account.

Everything under `src/ai/` is already host-neutral — only `gateway.ts`
(`onCall`/`defineSecret`) is Firebase-specific. What that migration still
needs, in a phase of its own:

1. **A host.** Vercel or Netlify: both run real Node, which `firebase-admin`
   requires. Cloudflare Workers is the one to avoid — it is not a Node
   runtime, and the Admin SDK's gRPC Firestore client does not run there.
2. **An HTTP adapter** replacing `onCall`: read the `Authorization: Bearer`
   header, verify the Firebase ID token with `getAuth().verifyIdToken()`
   (the callable did this implicitly), then call the same
   `resolveToolContext` -> `requireActiveAccount` -> `handleTurn` chain.
3. **CORS**, which callable functions handled for free.
4. **`src/lib/aiClient.ts` (Phase 8)** pointing at the new URL with a bearer
   token instead of `httpsCallable`.

## Risks / outstanding issues

- **First real cost/latency surface.** Every gateway call now hits a paid
  API. There is no per-hotel rate limit or spend cap yet; worth deciding
  before Phase 8 puts a chat box in front of users.
- **The service-account key is a full rules bypass.** It must live only in
  the host's secret store. The root `.gitignore` already blocks
  `*serviceAccountKey*.json`, and nothing reads a key file from the repo.
- Phase 1's two open questions still stand: the dual booking collections
  (`accomodation` vs `reservations`), which Phase 4 must resolve, and
  dropping housekeeping/maintenance tools from V1.

---

PHASE COMPLETE: Phase 3 — AI Provider Abstraction
Implemented:
- Provider-agnostic `AIProvider` interface plus message/tool/response types
- Env-driven configuration (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`,
  `AI_MAX_TOKENS`, `AI_EFFORT`) with validation and clear failure messages
- OpenAI implementation (Responses API, default `gpt-5.6`, `store: false`)
  and an Anthropic implementation, selected by one env var
- Orchestrator wired to the provider, with honest degradation on every
  failure path and a placeholder system prompt until Phase 7
- Firebase Admin credentials that work off Google infrastructure, for the
  gateway's move to a non-Firebase host
Files created:
- functions/scripts/smoke.js
- functions/src/ai/provider.ts
- functions/src/ai/providers/openai.ts
- functions/src/ai/providers/anthropic.ts
- functions/.env.example
- docs/ai/PHASE_3_NOTES.md (this document)
Files modified:
- functions/src/ai/orchestrator.ts
- functions/src/ai/gateway.ts
- functions/src/admin.ts
- functions/package.json (+ package-lock.json)
Dependencies added:
- openai, @anthropic-ai/sdk (functions package only)
Database changes:
- none
Tests:
- none added (the `functions/` Vitest suite is Phase 15); config resolution
  and Firestore access verified against the built output with real
  credentials, as recorded above. `npm run smoke` covers what the sandbox's
  blocked egress could not.
Validation:
- lint: not runnable in functions/ (pre-existing, see above)
- typecheck: clean (`npx tsc --noEmit`)
- build: clean (`npm run build`)
Risks / outstanding issues:
- No rate limiting or spend cap on a now-billable endpoint
- The gateway has no runtime until it is moved off Cloud Functions (Spark
  plan); host not yet chosen — see "Hosting" above
- Phase 1's dual-booking-collection decision still needs confirmation
  before Phase 4
NEXT PHASE:
Phase 4 — Read-only tools backed by real data
STATUS:
WAITING FOR APPROVAL
