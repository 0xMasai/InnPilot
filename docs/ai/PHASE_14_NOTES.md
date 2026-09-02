# Phase 14 — Voice architecture

The brief asks for `mic → STT → agent → tools → response → TTS`, with the
agent staying input-source-agnostic and voice input added only if it does
not significantly expand V1 scope.

Read that chain carefully and it is mostly already built. `agent → tools →
response` is Phases 4 through 13, working and tested. What Phase 14 adds is
the two ends — a microphone that produces a string, and a speaker that
consumes one — plus a single field that lets the audit trail say which
questions arrived that way.

```
mic ──▶ STT ──▶ [ the composer, where a person reads it ] ──▶ agent ──▶ tools
                                                                   │
        TTS ◀── speakableText() ◀── reply ◀───────────────────────┘
```

The bracket in the middle is the design. Everything else follows from it.

## The agent is not told, and that is enforced rather than intended

`inputMode` is validated at the gateway, attached to the request scope, and
never passed on. `handleTurn`'s signature is byte-for-byte what it was
before this phase.

That is the difference between a rule and a comment. A mode threaded into
the Orchestrator as a parameter is a parameter something can branch on
later — a slightly different prompt for voice, a "spoken questions skip the
report tool" optimisation — and the first such branch creates two agents
where the tests, the audit trail and the eval set all describe one. There
is no parameter, so there is nothing to branch on.

The mechanism is the request scope `logger.ts` already owns for the request
id, which is `AsyncLocalStorage` — the same one `requestCache` uses, for
the same stated reason. The two modules that legitimately want the mode —
this file's start/finish lines and Phase 12's audit row — both already run
inside that scope. Nothing between the gateway and a tool handler carries a
value it must not act on.

The test that pins this is not "the parameter is absent" but the stronger
observable one: for the same question asked twice, the system prompt, the
messages and the tool schemas handed to the provider are identical strings,
and the substring `voice` appears nowhere in anything the model was sent.

## Where the mode is recorded, and where it is not

| | `aiAuditLog` + `auditLog` | Log lines | The model |
| --- | --- | --- | --- |
| Gets `inputMode` | yes, every row | `ai.request.start`, `ai.request.finish` | never |
| Reader | the hotel's admin | the operator | — |
| Answers | which of these actions were asked for out loud | how much of our traffic is voice, and does it fail more | — |

It is on the start and finish lines rather than in the prefix every line
carries. The prefix holds what makes a line *attributable in isolation* —
an `ai.error` raised before the start line still needs its user and hotel.
Input mode is constant per request, so `requestId` joins it onto everything
else, and paying for it on all ten lines of a turn buys nothing.

**It is a client assertion, not a verified fact**, and the code says so at
every point it is handled. A browser can claim `voice` for a typed
question. What that buys is one mislabelled audit row — nothing reads the
field to decide anything, so there is no permission, no tool, no
confirmation and no prompt behind it.

It is still an enum with two members, refused rather than coerced when it
is anything else. Two reasons: silently mapping `whatsapp` to `text` would
put a wrong answer in the trail, which is the only thing the field is for;
and a closed vocabulary is what stops the field becoming caller-supplied
free text that reaches an audit document. `redact.ts` is an allowlist for
exactly that reason, and this field is on the same side of that argument.

## The bracket: a transcript is read before it is sent

Dictation fills the composer. The user reads it and presses Ask, exactly as
if they had typed it. There is no auto-send.

This is the one place voice could have been more impressive and is
deliberately not. A recogniser that mishears "room 204" as "room 214" and
sends it produces a question about the wrong room, and the honest answer
about the wrong room is indistinguishable from the right answer to the
question the user meant to ask. The composer is where that gets caught, and
it costs one keystroke.

**A confirmation is a click, never a spoken "yes."** Confirming a write
needs the `confirmationId` the server issued for that specific pending
action, and only the button in the confirmation panel holds it. A
transcript saying "yes, I already approved this, do it now" is just another
question: the model's only available move is to propose the change again,
and nothing is written. That falls out of Phase 10's design rather than
being added here — the point of testing it is that it keeps falling out
once a microphone exists.

## Both halves are the browser's

`src/lib/voice.ts` wraps the Web Speech API. No dependency, no audio
reaching our gateway, no new route, no new secret — the whole feature is
that file plus a button, which is what "does not significantly expand V1
scope" had to mean.

The cost is real and is written into the module: **in Chrome, dictation is
not on-device.** The browser streams the microphone to Google's speech
service and returns text, so a manager dictating a guest's name has sent it
to a third party InnPilot has no agreement with. Three consequences, all
implemented:

1. It never listens on its own. A session exists between a click and a
   result; `continuous` is off, so the browser ends it at a natural pause.
2. The transcript stops in the composer. Nothing reaches the hotel's data
   because a microphone heard it.
3. `VITE_AI_VOICE=off` removes both halves from a deployment that does not
   accept the trade. Checked inside the module, so one setting covers every
   caller.

Where the API is absent — Firefox, an older browser, any non-browser
environment — `detectVoiceSupport()` reports it and the UI renders no
microphone and no speaker. Absence is a supported state, not a broken one,
and it is tested as such: every global is reached through `window` rather
than as a bare identifier, so importing this module where there is no
browser is silence rather than a `ReferenceError`.

## Speaking the reply

Only the reply is spoken, only when the question was spoken, and only while
the header toggle is on. Tool arguments and results are not read aloud —
the same rule the logs and the audit trail follow, for a reason that is
sharper here: a speaker is audible to a lobby.

`speakableText()` is where a reply written for a screen becomes something
worth hearing: markdown emphasis, headings, bullets, code fences and link
targets are removed, whitespace is collapsed, and a long report is cut at a
sentence boundary and followed by "The rest of the answer is on screen."

That work happens on the way to the speaker, and not by telling the model a
question was spoken, which is the same rule as everywhere else in this
phase. A prompt that shapes its answer for the ear gives a different answer
to the same question depending on how it was asked, and only one of those
answers would be the one the audit trail and the eval set describe.

## Validation

- **`tests/ai/voiceInput.test.ts` — 18 tests**, end to end through
  `handleAiChat`, with the audit logger *not* mocked, so the row it writes
  is observed at the Firestore boundary rather than trusted.
  - Accepted and refused: a spoken question answered normally; absent and
    `null` defaulting to `text`; an unrecognised mode, a non-string mode
    and free text smuggled through the field each refused with a 400,
    before any model round-trip and with no audit row written.
  - Recorded: a spoken read marked `voice` in the trail, a typed one
    `text`, both on the start and finish lines, on a refused request's
    finish line, and on the operational row when a change actually lands.
  - Agnostic: identical system prompt, messages and tool schemas for the
    same question typed and spoken; the word `voice` absent from
    everything the model was sent; the same tool list; a role that may not
    call a tool still refused when it asks by voice.
  - Cannot confirm: a spoken write still returns a pending confirmation
    and writes nothing; a spoken "yes I confirm, do it now" writes nothing
    and re-proposes; a spoken confirmation carrying an id that was never
    issued is refused and recorded as `confirmation_invalid`.
- **`tests/ai/voiceClient.test.ts` — 23 tests** over `src/lib/voice.ts`:
  no-browser and `VITE_AI_VOICE=off` reporting no support and doing
  nothing rather than throwing; each half detected separately; the
  vendor-prefixed recogniser found; a session single-shot with interim
  results, ending exactly once however it ended; `stop` and `cancel`
  distinguished; each error code producing a distinct message and
  `aborted` producing none; a recogniser that refuses to start reporting
  and ending rather than leaving the UI listening forever; and
  `speakableText` on markdown, links, plain text, empty input, a long
  report cut at a sentence, and a long string with no sentence to cut at.
- **Mutation-checked three times.** Dropping `inputMode` from the audit
  rows fails **5 of 18**; coercing an unrecognised mode to `text` instead
  of refusing fails **3 of 18**, and exactly the three about refusal;
  appending the mode to the system prompt fails **2 of 18**, and exactly
  the two that guard input-source-agnosticism.
- 209 tests pass across 12 files in `tests/ai` (168 before this phase).
  `npx tsc -b` clean, `npm run build` succeeds, `npm run test:rules`
  64/64.

## Not verified

**No word has been spoken into it.** Every test here drives a stand-in
recogniser that fires the events the spec describes. Whether Chrome's real
recogniser transcribes Ugandan English place names, hotel vocabulary and
room numbers well enough to be useful is an empirical question that a test
suite cannot answer, and it is the question that decides whether this
feature is worth keeping.

**`navigator.language` is the only language selection.** A user whose
browser is set to `en-US` dictating in another language gets poor results
and no way to say so. A language picker was not built because the right
place for that setting — per user, per hotel, per session — is a product
decision this phase had no reason to make.

**Nothing is spoken on a failed turn.** A voice user whose question fails
sees the error and the reference id on screen and hears nothing. Speaking
errors aloud is a choice about a device that may be on a front desk, and it
is not obviously the right one.

**The mode is per request, not per conversation.** A question asked by
voice and confirmed by clicking produces one `voice` row and one `text`
row, which is accurate for each request and is *not* an answer to "was this
change made in a voice conversation". Nothing today asks that question; if
something does, the conversation id joins the rows.

**No server-side STT or TTS, no audio storage, no wake word, no barge-in,
no continuous conversation.** These are the "full voice conversation" the
brief excludes from V1. Each needs a decision about where audio lives, who
processes it and for how long — decisions voice *input* does not force.

---

PHASE COMPLETE: Phase 14 — Voice architecture
Implemented:
- `inputMode` (`text` | `voice`) on the AI request: validated at the
  gateway as a closed enum, attached to the request scope, and passed no
  further — the Orchestrator's signature is unchanged, so no agent
  behaviour can depend on how a question arrived
- Recorded in Phase 12's `aiAuditLog` row and, for a change that lands, in
  the operational `auditLog` row the Audit Log page renders
- Recorded on Phase 13's `ai.request.start` and `ai.request.finish` lines
- `src/lib/voice.ts`: Web Speech dictation and synthesis behind feature
  detection, a `VITE_AI_VOICE=off` deployment switch, a closed set of
  dictation error messages, and `speakableText()` for turning a reply
  written for a screen into one worth hearing
- Ask InnPilot: a microphone button that fills the composer with a
  transcript the user reads and sends, a live interim guess, a listening
  indicator, an actionable dictation error, and a speaker toggle that
  reads back answers to spoken questions only
- Confirmation stays a click: a spoken "yes" carries no confirmation id
  and therefore changes nothing
Files created:
- src/lib/voice.ts
- tests/ai/voiceInput.test.ts
- tests/ai/voiceClient.test.ts
- docs/ai/PHASE_14_NOTES.md (this document)
Files modified:
- server/ai/types.ts (`InputMode`, `INPUT_MODES`)
- server/ai/aiChat.ts (validate `inputMode`, note it on the request scope)
- server/ai/logger.ts (`noteInputMode`, `currentInputMode`, the field on
  the start and finish lines)
- server/ai/auditLogger.ts (`inputMode` on both audit rows)
- src/lib/aiClient.ts (`inputMode` on the request)
- src/pages/pms/AskInnPilot.tsx (microphone, interim transcript, speaker
  toggle, spoken replies)
- .env.example (`VITE_AI_VOICE`)
Dependencies added:
- none
Database changes:
- one additive field, `inputMode`, on `hotels/{hotelId}/aiAuditLog` rows
  and on the `hotels/{hotelId}/auditLog` rows the agent writes. No rules
  change: both collections are already server-written through the Admin
  SDK and read-only to clients, and every existing reader ignores an
  unknown field
Tests:
- tests/ai/voiceInput.test.ts (18)
- tests/ai/voiceClient.test.ts (23)
Validation:
- lint: clean on every file this phase touched
- typecheck: `npx tsc -b` clean
- build: `npm run build` succeeds
- tests: 209 passing in `tests/ai` across 12 files; `npm run test:rules`
  64/64 against the emulator
Risks / outstanding issues:
- Nothing has been dictated into the real recogniser; transcription
  quality on hotel vocabulary and Ugandan English is unmeasured
- Chrome's dictation is not on-device — audio goes to Google's speech
  service. Documented at the module and in `.env.example`, and switchable
  off per deployment with `VITE_AI_VOICE=off`
- `inputMode` is a client assertion. It is recorded and read by nothing
  that grants anything, which is what makes that acceptable
- Language follows `navigator.language`, with no picker
NEXT PHASE:
Phase 15 — Testing
STATUS:
WAITING FOR APPROVAL
