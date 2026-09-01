# Phase 3 — AI Provider Abstraction

The agent can now actually call a model. Everything vendor-specific is
confined to one file; everything configurable comes from the environment.

```
functions/src/ai/
  config.ts                 # env + secret -> AIConfig; AI_API_KEY defineSecret
  provider.ts               # AIProvider interface, neutral types, factory
  providers/
    anthropic.ts            # the only file that imports a vendor SDK
```

## The interface

```ts
interface AIProvider {
  readonly name: string;
  readonly model: string;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}
```

`ProviderRequest` is `{ systemPrompt, messages, tools }`; a message is a user
turn, an assistant turn (text + optional tool calls), or a round of tool
results. That is the common denominator of every current tool-calling API, so
adding a second provider is one file under `providers/` plus one line in
`createProvider` — no change to orchestration, tools, prompt, or permission
logic. The layer maps shapes and nothing else: it does not interpret tool
calls, decide whether a tool may run, or execute anything.

`getProvider()` is memoized per function instance (config is fixed per deploy)
and returns `null` when no provider is configured. `resetProviderCache()`
exists as a test seam.

## Configuration

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AI_PROVIDER` | to enable the agent | — | unset = not connected; `anthropic` supported |
| `AI_MODEL` | no | `claude-opus-5` | any provider model id |
| `AI_MAX_TOKENS` | no | 4096 | |
| `AI_TIMEOUT_MS` | no | 50000 | |
| `AI_MAX_RETRIES` | no | 1 | SDK retries for transient failures |
| `AI_EFFORT` | no | provider default | `low`…`max` |
| `AI_API_KEY` | to enable the agent | — | **secret, not an env var** |

Non-secret values are ordinary env vars (`functions/.env`, documented in the
new `functions/.env.example`, which firebase-functions loads automatically).
The API key is a Cloud Functions secret bound to the callable:

```
firebase functions:secrets:set AI_API_KEY
```

No `VITE_` prefix on any of them, deliberately: `VITE_*` values (see the root
`firebase.ts`) are bundled into public client JS, which is exactly what an LLM
key must never be. Nothing account- or deployment-specific is hard-coded; the
only literals are documented, overridable defaults.

`readAIConfig()` separates two failure modes on purpose:

- **`AI_PROVIDER` unset → `null`.** The deploy simply has no AI connected, and
  the Orchestrator says so. This is the honest-degradation rule from the brief
  applied to configuration.
- **A value present but unusable → throws `AIConfigError`.** A typo in a
  deploy is loud (logged, plus a "not configured" reply to the user) rather
  than silently downgraded to a broken assistant.

## Decisions made while implementing (flagging, not asking permission for)

- **The Orchestrator is now wired to the provider.** Phase 2 left `handleTurn`
  inert; leaving it inert for two more phases would have meant shipping a
  provider nothing calls and no way to exercise Phase 7's prompt. A turn now
  runs end-to-end: history → provider → persisted reply. It is still not the
  Phase 6 tool loop — the registry is empty and `tools: []` is sent — and that
  is safe precisely because of Phase 7: the prompt tells the model it has no
  tools and must not answer operational questions from guesswork, so an
  un-tooled deploy declines rather than fabricates.
- **Worst-case provider time is bounded to fit the function.** The SDK retries
  transient failures, so worst-case wall time is
  `AI_TIMEOUT_MS x (AI_MAX_RETRIES + 1)`. With the SDK's own defaults (2
  retries) and a 90s timeout that reaches 270s — well past the callable's
  limit, which would surface as an opaque function timeout instead of a
  reportable error. Defaults are now 50s x 2 attempts = 100s, under the
  callable's `timeoutSeconds: 120`. Both halves are documented where they are
  set, since changing one without the other reintroduces the bug.
- **The Anthropic SDK is imported lazily** inside `createProvider`, so a deploy
  configured for a different provider never pays its load cost at cold start.
- **`anthropic` is the only provider implemented**, per the brief's "one
  implementation, do not over-engineer". `PROVIDER_NAMES` is the single place
  to extend.
- **Tool messages are skipped when replaying history.** Phase 2's message
  store keeps no `tool_use` ids, so stored tool messages cannot be replayed as
  a valid round-trip; Phase 6 extends the store when the tool loop needs it.
  Leading assistant messages are also dropped, since a conversation must open
  on a user turn.
- **Errors never carry the key or the request body.** SDK errors become
  `AIProviderError` with a `retryable` flag (429/408/409/5xx/network) and the
  provider's own message; the user gets "I couldn't reach the AI service —
  nothing was retrieved and nothing was changed", never a fabricated answer.
  A provider `refusal` gets its own reply. Structured `logger.info`/`error`
  lines (`ai.turn.completed`, `ai.turn.provider_error`) carry conversation id,
  provider, model, stop reason, and token usage — a starting point for Phase
  13, not the whole of it.

## Validation

- `functions`: `tsc --noEmit` clean; `npm run build` succeeds.
- **Provider exercised against a local mock of the Messages API** (no real API
  calls, no spend), verifying the request the SDK actually puts on the wire and
  the parsing of what comes back:
  - a 4-turn history (user → assistant with a tool call → tool results → user)
    maps to the correct `messages` array, with tool results batched into one
    user turn (which is what keeps parallel tool use working), and a tool
    schema maps to `input_schema`;
  - a response containing text + a `tool_use` block parses into
    `{ text, toolUses, stopReason: "tool_use", usage }`.
  - HTTP 400 → `retryable=false`; 429 and 503 → `retryable=true`, with the
    retry visible in elapsed time; no API key in any error message.
  - `AI_PROVIDER` unset → `getProvider()` returns `null`;
    `AI_PROVIDER=openai` and `AI_MAX_TOKENS=-5` → `AIConfigError`; missing
    secret → `AIConfigError` naming the `firebase functions:secrets:set`
    command.
- Not done (deliberately): a real deploy, a real provider call, and the
  `functions/` Vitest suite (Phase 15). The mock exercise above is a smoke
  check, not a test suite.
- Root app untouched — no file outside `functions/` and `docs/ai/` changed.
