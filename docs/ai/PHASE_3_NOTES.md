# Phase 3 — AI Provider Abstraction

Phase 2's infrastructure is in place and unchanged in shape; this phase
gives it an LLM, behind an interface, driven entirely by environment
variables. No secrets, model ids, or endpoints are hard-coded anywhere.

## What exists now

```
functions/src/ai/
  provider.ts              # AIProvider interface, config resolution, factory
  providers/
    anthropic.ts           # the one implementation (only file importing an LLM SDK)
  orchestrator.ts          # now calls the provider; still no tools
  gateway.ts               # binds the AI_API_KEY secret to the callable
functions/.env.example     # documents every AI_* variable
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
| `AI_PROVIDER` | no | `anthropic` | `functions/.env` |
| `AI_MODEL` | no | provider default (`claude-opus-5`) | `functions/.env` |
| `AI_MAX_TOKENS` | no | `4096` | `functions/.env` |
| `AI_EFFORT` | no | `medium` | `functions/.env` |
| `AI_API_KEY` | **yes** | — | Cloud Functions **secret** |

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
- **`AI_API_KEY` is a Firebase secret, bound in `gateway.ts`**
  (`defineSecret` + `secrets: [aiApiKey]` on the callable), which is what
  places it in `process.env` at runtime. `provider.ts` itself reads only
  `process.env`, so it stays free of `firebase-functions` imports and is
  testable with a plain env object (Phase 15).
- **Provider chosen: Anthropic (`@anthropic-ai/sdk`), default model
  `claude-opus-5`.** The repo had no prior LLM provider of any kind, and
  Phase 1 deferred the choice to this phase. The default is overridable per
  deployment via `AI_MODEL` without a code change.
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
  `lib/ai/provider.js` and `lib/ai/providers/anthropic.js`.
- Config resolution exercised against the built output: defaults, overrides
  (case-insensitive provider/effort), memoization, cache rebuild on a
  rotated key, and rejection of an unsupported provider, a negative token
  cap, and an unknown effort value — all behave as documented above.
- `npm run lint` in `functions/` still cannot run: there is no
  `functions/eslint.config.js`, so ESLint falls back to the root config,
  whose plugins are not installed for this package. Pre-existing from
  Phase 2, not introduced here; worth fixing when the package gets its own
  test/lint setup in Phase 15.
- Root app: untouched. No file outside `functions/` and `docs/ai/` changed.
- No live API call was made — that needs a real `AI_API_KEY` and a Firebase
  project, which this phase deliberately does not provision.

## Risks / outstanding issues

- **First real cost/latency surface.** Every `aiChat` call now hits a paid
  API. There is no per-hotel rate limit or spend cap yet; worth deciding
  before Phase 8 puts a chat box in front of users.
- **Deploying now requires the secret to exist** — `firebase deploy` will
  prompt for `AI_API_KEY` if it has never been set for the project.
- Phase 1's two open questions still stand: the dual booking collections
  (`accomodation` vs `reservations`), which Phase 4 must resolve, and
  dropping housekeeping/maintenance tools from V1.

---

PHASE COMPLETE: Phase 3 — AI Provider Abstraction
Implemented:
- Provider-agnostic `AIProvider` interface plus message/tool/response types
- Env-driven configuration (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`,
  `AI_MAX_TOKENS`, `AI_EFFORT`) with validation and clear failure messages
- Anthropic implementation (the only vendor-SDK file), with adaptive
  thinking, effort, refusal fallback, and bounded timeout/retries
- Orchestrator wired to the provider, with honest degradation on every
  failure path and a placeholder system prompt until Phase 7
- `AI_API_KEY` bound to the callable as a Firebase secret
Files created:
- functions/src/ai/provider.ts
- functions/src/ai/providers/anthropic.ts
- functions/.env.example
- docs/ai/PHASE_3_NOTES.md (this document)
Files modified:
- functions/src/ai/orchestrator.ts
- functions/src/ai/gateway.ts
- functions/package.json (+ package-lock.json)
Dependencies added:
- @anthropic-ai/sdk (functions package only)
Database changes:
- none
Tests:
- none added (the `functions/` Vitest suite is Phase 15); config resolution
  verified manually against the built output, as recorded above
Validation:
- lint: not runnable in functions/ (pre-existing, see above)
- typecheck: clean (`npx tsc --noEmit`)
- build: clean (`npm run build`)
Risks / outstanding issues:
- No rate limiting or spend cap on a now-billable endpoint
- Deploy requires the AI_API_KEY secret to be set for the project
- Phase 1's dual-booking-collection decision still needs confirmation
  before Phase 4
NEXT PHASE:
Phase 4 — Read-only tools backed by real data
STATUS:
WAITING FOR APPROVAL
