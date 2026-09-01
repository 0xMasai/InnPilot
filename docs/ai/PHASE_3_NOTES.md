# Phase 3 — AI Provider Abstraction

Phase 2's module structure is intact; this phase gives it an LLM behind an
interface, driven entirely by environment variables, and moves the gateway
onto a host that can actually run it. No secrets, model ids, or endpoints
are hard-coded anywhere.

## What exists now

```
server/                      # was functions/src — see "Hosting" below
  admin.ts                   # Admin SDK app; credentials that work off Google infra
  ai/
    aiChat.ts                # gateway core: verify ID token -> context -> guard -> turn
    provider.ts              # AIProvider interface, config resolution, factory
    providers/openai.ts      # the one implementation (Responses API)
    orchestrator.ts          # calls the provider; still no tools
    contextManager.ts, permissionGuard.ts, toolRegistry.ts,
    confirmationManager.ts, conversationManager.ts, auditLogger.ts
  scripts/smoke.ts           # `npm run smoke` — verifies credentials end to end
api/ai-chat.ts               # Vercel adapter: method, CORS, bearer token, status codes
vercel.json                  # maxDuration for the AI function
.env.example                 # every variable, public and secret, in one place
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
| `AI_PROVIDER` | no | `openai` | Vercel env |
| `AI_MODEL` | no | `gpt-5.6` | Vercel env |
| `AI_MAX_TOKENS` | no | `4096` | Vercel env |
| `AI_EFFORT` | no | `medium` | Vercel env |
| `AI_API_KEY` | **yes** | — | Vercel env (secret) |
| `FIREBASE_SERVICE_ACCOUNT` | **yes** on Vercel | ADC | Vercel env (secret) |
| `ALLOWED_ORIGINS` | only cross-origin | same-origin only | Vercel env |

Bad values fail loudly at resolution (unknown provider, non-integer token
cap, unknown effort) rather than silently falling back to a default.

## Hosting: the gateway left Cloud Functions

The project stays on the Spark plan, and Cloud Functions cannot deploy
without Blaze, so the `aiChat` callable had no runtime. It now runs on
Vercel, authenticating to Firestore with the
`firebase-adminsdk-fbsvc@hotel-management-c183c` service account.

That decision collapsed the `functions/` package into the root one:

- `functions/src/*` -> `server/*`. Same modules, same names, one file
  renamed (`gateway.ts` -> `ai/aiChat.ts`) because it is no longer a
  Firebase callable.
- `functions/package.json`, its lockfile, and its tsconfig are gone.
  Vercel builds from the root package, so a second package would mean a
  second install the deployment never uses. `firebase-admin` moved from the
  root's devDependencies to dependencies (the function needs it at runtime)
  and `openai` joined it; `tsconfig.server.json` typechecks `server/` and
  `api/` as part of `tsc -b`.
- `firebase.json` no longer declares a functions codebase or emulator. The
  Firestore and Storage rules, and the Firestore emulator the rules tests
  use, are untouched.

`api/ai-chat.ts` holds every HTTP concern and nothing else; `server/` has
no idea it is behind Vercel. Moving hosts again means rewriting that one
file.

### What the callable did for free, and now doesn't

- **ID-token verification.** `aiChat.ts` now calls
  `getAuth().verifyIdToken()` explicitly. Bad, expired, revoked, and
  wrong-project tokens all return the same 401 with no distinguishing
  detail.
- **CORS.** Handled in the adapter from `ALLOWED_ORIGINS`. Unset grants
  nothing rather than defaulting to `*` — a wildcard would let any site
  spend this deployment's API budget with a stolen ID token. Same-origin
  (app and API on one Vercel project) needs no value at all.
- **Timeouts.** `vercel.json` sets `maxDuration: 60`; the provider caps a
  call at 45s, so a slow model surfaces as our own honest error rather than
  a platform timeout.

## Decisions made while implementing (flagging, not asking permission for)

- **Provider: OpenAI (`openai`, Responses API), default model `gpt-5.6`** —
  your call. `AI_MODEL` swaps it per environment (`gpt-5.6-terra` and
  `-luna` are the cheaper drop-ins) with no code change.
- **`store: false` on every OpenAI request.** Hotel operational data is not
  retained provider-side; conversation history stays in Firestore, where
  the rest of the app's data already lives.
- **The Anthropic implementation was removed** when the package merged with
  the frontend's. It is statically imported, so an unused second SDK would
  land in every `npm install` for the web app and in the function bundle.
  The abstraction is unchanged — adding a provider is one file plus one
  entry in `FACTORIES` and `DEFAULT_MODELS` — and git history holds the
  reference implementation.
- **Firebase Admin accepts a service-account credential from
  `FIREBASE_SERVICE_ACCOUNT`** (raw JSON or base64), falling back to
  Application Default Credentials. Vercel has no Google metadata server, so
  the env var is the deployed path; the ADC fallback keeps local runs and
  any future Google host working.
- **`.env.example` is at the repo root**, now that root is the only
  package. It documents the `VITE_*` split explicitly, because that prefix
  is the line between "bundled into public browser JS" and "server-side
  only" — and an API key on the wrong side of it is the failure this whole
  arrangement exists to prevent.
- **Orchestrator is live but still tool-less.** It sends the last 20
  messages of history plus a placeholder system prompt (Phase 7 replaces
  it). With no tools registered, that prompt forbids stating or estimating
  any operational, financial, reservation, or guest figure and requires the
  model to say data access isn't connected — the brief's "never fabricate
  data" rule applied to "no tools yet".
- **Every failure path degrades honestly.** Unconfigured provider,
  misconfiguration, upstream failure, and refusal each return a distinct
  plain-English reply saying no answer is available; none invents one.
  Details go to `console.error` (structured logging is Phase 13).
- **`ProviderRequestError` does not carry the SDK's error message text**,
  only its type and HTTP status, so a provider error cannot echo request
  content (which will carry hotel data from Phase 4 onward) to the client.
  The adapter's catch-all does the same: 500 with a fixed string.

## Validation

- `npx tsc -b` clean across all four projects (app, node, server, api).
- `npm run build` (typecheck + Vite) succeeds; the frontend is unaffected.
- `npx firebase emulators:exec --only firestore "npx vitest run tests/rules"`
  — **48/48 pass**, confirming the trimmed `firebase.json` still drives the
  emulator the existing rules tests depend on.
- **Firebase Admin verified against the real project.** A read-only query
  with the service account reached Firestore: `users` and `hotels` readable,
  roles as the Context Manager expects (`super_admin` with no hotel, `staff`
  with a hotelId), one hotel present. Nothing was written.
- **The OpenAI call is still unverified.** The development sandbox's egress
  proxy refuses `CONNECT api.openai.com` with a 403 — confirmed with a dummy
  token, so it is the network, not the credential. `npm run smoke` reaches
  the provider step and reports that 403 cleanly; run it from a machine with
  open egress to confirm the key.
- That block did test a failure path for free: the 403 became
  `ProviderRequestError(403)` with no request content leaked, which is what
  the orchestrator turns into "I could not reach the AI service just now".
- `npm run lint` (root ESLint) now covers `server/` and `api/` as ordinary
  TypeScript; the old unrunnable `functions/` lint script is gone with the
  package.

### Credentials in this working copy

`.env` (provider config + `AI_API_KEY`) and `serviceAccountKey.json` exist
locally and are **git-ignored** — confirmed with `git check-ignore`; neither
has been staged. On Vercel the same values go in the project's Environment
Variables, with the service account as `FIREBASE_SERVICE_ACCOUNT`.

**Both credentials were shared over chat and should be rotated** once the
gateway is deployed and working: a new key in the OpenAI dashboard, and a
new service-account key in the Firebase console (which lets you delete the
old one outright).

## Deploying

1. Import the repo as a Vercel project (framework auto-detects as Vite).
2. Add the environment variables above. `FIREBASE_SERVICE_ACCOUNT` is the
   whole service-account JSON on one line; base64 also works if the
   dashboard mangles it.
3. Deploy, then `POST /api/ai-chat` with a signed-in user's Firebase ID
   token:

   ```
   Authorization: Bearer <idToken>
   Content-Type: application/json
   {"message":"What is our occupancy today?","conversationId":"<any id>"}
   ```

   Expect a reply that declines to give a figure. A number means the model
   is fabricating and the system prompt is not holding.
4. If the app is served from a different origin than the function, set
   `ALLOWED_ORIGINS` to that origin.

## Risks / outstanding issues

- **First real cost surface.** Every gateway call hits a paid API, with no
  per-hotel rate limit or spend cap. Worth deciding before Phase 8 puts a
  chat box in front of users.
- **The service-account key is a full rules bypass.** Vercel env only.
- Phase 1's dual-booking-collection decision (`accomodation` vs
  `reservations`) still needs confirmation before Phase 4.

---

PHASE COMPLETE: Phase 3 — AI Provider Abstraction
Implemented:
- Provider-agnostic `AIProvider` interface plus message/tool/response types
- Env-driven configuration (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`,
  `AI_MAX_TOKENS`, `AI_EFFORT`) with validation and clear failure messages
- OpenAI implementation (Responses API, `gpt-5.6`, `store: false`)
- Orchestrator wired to the provider, honest degradation on every failure
  path, placeholder system prompt until Phase 7
- Gateway moved off Cloud Functions to Vercel: transport-independent core,
  explicit ID-token verification, CORS, and an HTTP adapter
- Admin credentials that work without a Google metadata server
- `npm run smoke` to verify a deployment's credentials end to end
Files created:
- api/ai-chat.ts, vercel.json, tsconfig.server.json
- server/ai/provider.ts, server/ai/providers/openai.ts
- server/scripts/smoke.ts
- .env.example (root), docs/ai/PHASE_3_NOTES.md (this document)
Files modified:
- server/ai/orchestrator.ts, server/admin.ts
- package.json (deps + smoke script), tsconfig.json, firebase.json, .gitignore
Files moved/removed:
- functions/src/* -> server/* (gateway.ts -> ai/aiChat.ts)
- functions/package.json, lockfile, tsconfig, index.ts, .env.example removed
- server/ai/providers/anthropic.ts removed (see decisions)
Dependencies added:
- openai (runtime), @vercel/node (types); firebase-admin moved dev -> runtime
Database changes:
- none
Tests:
- none added (the server-side Vitest suite is Phase 15). Existing rules
  tests re-run green (48/48); `npm run smoke` covers credential wiring.
Validation:
- lint: root ESLint now covers server/ and api/
- typecheck: clean (`npx tsc -b`, all four projects)
- build: clean (`npm run build`)
Risks / outstanding issues:
- OpenAI key unverified from this sandbox (egress blocked) — `npm run smoke`
  confirms it from anywhere with open network access
- No rate limiting or spend cap on a billable endpoint
- Both shared credentials should be rotated after deployment
- Phase 1's dual-booking-collection decision still needs confirmation
NEXT PHASE:
Phase 4 — Read-only tools backed by real data
STATUS:
WAITING FOR APPROVAL
