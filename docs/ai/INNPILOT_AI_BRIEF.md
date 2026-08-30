# InnPilot AI Agent v1 — Implementation Brief

> Source of truth for building the InnPilot AI Agent. Read this before starting
> or resuming any phase. Do not deviate from the execution protocol below.

## Execution protocol (non‑negotiable)

1. Execute exactly ONE phase per instruction.
2. After completing that phase, STOP.
3. Do not automatically continue to the next phase.
4. Do not implement future phases "while you're here."
5. Do not modify unrelated parts of the application.
6. Do not rewrite working InnPilot functionality.
7. Do not make architectural assumptions when the repository can answer the question.
8. Before making changes, inspect the existing implementation relevant to the current phase.
9. After each phase, provide a concise implementation report.
10. Wait for explicit user approval before proceeding to the next phase.

### Phase completion report format

```
PHASE COMPLETE: <phase name>
Implemented:
- ...
Files created:
- ...
Files modified:
- ...
Dependencies added:
- ...
Database changes:
- ...
Tests:
- ...
Validation:
- lint:
- typecheck:
- build:
Risks / outstanding issues:
- ...
NEXT PHASE:
<phase name>
STATUS:
WAITING FOR APPROVAL
```

## Critical principle

**DO NOT REWRITE INNPILOT.** Understand the existing codebase and integrate
the AI layer into the architecture that already exists. Do not replace
working functionality simply because it would be architected differently
from scratch.

## Mission

Transform InnPilot from a traditional PMS into an AI‑powered hospitality
operations platform. V1 must let an authenticated hotel manager:

1. Ask questions about their hotel's real operational data.
2. Receive accurate, concise, contextual answers.
3. Request operational reports.
4. Analyze hotel performance.
5. Execute selected operational actions through natural language.
6. Have every AI action respect authentication, authorization, tenant/property
   boundaries, and audit requirements.
7. Establish an architecture that can later support voice, proactive agents,
   and specialized hospitality agents.

## Product vision

InnPilot should eventually become "the AI operating system for African
hospitality." The PMS remains the system of record; the AI agent is the
intelligence and natural‑language interface on top of it. Future agents:
Operations, Finance, Revenue, Housekeeping, Maintenance, Management; plus
voice, WhatsApp, proactive alerts, automated briefings, multi‑property
intelligence. **V1 stays focused — do not prematurely build the whole vision.**

## Target agent architecture

```
User
 ↓
InnPilot AI Interface
 ↓
Authenticated AI Request
 ↓
AI Gateway
 ↓
Agent Orchestrator
 ├── Context Manager
 ├── Tool Registry
 ├── Permission Guard
 ├── Confirmation Manager
 ├── Conversation Manager
 └── Audit Logger
              ↓
        Validated Tool Layer
              ↓
     Existing InnPilot Services/API
              ↓
           Database
```

Keep modules independent. Do not couple the AI directly to UI components.
**The LLM must never receive unrestricted database access** and must never
be trusted to enforce authorization — the authenticated context
(`userId`, `hotelId`, `role`, `permissions`) must be server‑generated, never
supplied by the model.

## Phase list (execute one at a time, in order)

0. Repository inspection only — no code changes.
1. Implementation plan, based only on real repo findings.
2. AI infrastructure (Gateway, Orchestrator, and modules above) — minimum needed.
3. AI provider abstraction (env‑var driven, no hard‑coded secrets/IDs).
4. Read‑only tools only, backed by real data (occupancy, room status,
   check‑ins/outs, pending/maintenance tasks, revenue, expenses, restaurant
   sales, conference revenue, reservations, daily/weekly/monthly reports).
   Never fabricate data.
5. Security / Permission Guard — every tool independently validates user,
   property access, role, permission, input schema. Add tests for
   cross‑property access, privilege escalation, unauthorized tools, malicious
   parameters, prompt injection, sensitive data exposure.
6. Agent orchestration — select and call only the minimum relevant tools per
   request.
7. Centralized InnPilot AI system prompt (adapted to real roles/architecture):
   a hospitality operations assistant for authorized hotel managers; must use
   tools for factual data, never invent operational/financial/reservation/guest
   info, say so when data can't be retrieved, respect the authenticated
   user's property/role, distinguish retrieved facts from analysis, and
   require confirmation before write actions.
8. "Ask InnPilot" UI added to the existing dashboard (not a separate product),
   using the existing design system; shows user message, AI response, tool
   activity, loading/errors/confirmation/success states.
9. InnPilot Daily Briefing, built from real tool data (occupancy, check‑ins/
   outs, revenue, expenses, restaurant/conference revenue, outstanding
   balances, maintenance issues, insights). No PDF generation unless already
   trivial in the existing stack.
10. Controlled write tools (e.g. `update_room_status`, `create_maintenance_task`,
    `create_note`), gated by explicit, server‑side‑verified confirmation —
    never rely on the model alone to determine confirmation occurred.
11. Destructive‑action protection — avoid destructive tools entirely in V1
    (no delete of bookings/guests/financial records/expenses/users/hotel data).
12. Audit logging for every AI action (timestamp, userId, propertyId,
    conversationId, toolName, toolInput, toolResult/status, actionType,
    confirmationStatus, success/failure) — redact PII/secrets/tokens.
13. Error handling & observability — never fabricate data on tool failure;
    structured logs around AI request, tool invocation/duration/success,
    LLM latency/errors, confirmation flow.
14. Voice architecture (mic → STT → agent → tools → response → TTS); agent
    stays input‑source‑agnostic; basic voice input only if it doesn't expand
    V1 scope significantly.
15. Testing — unit (tool validation, authorization, property isolation,
    report calculations, confirmation logic, tool errors), agent/tool
    integration (question → expected tool), and security tests
    (cross‑property access denied, prompt injection resisted).
16. Hospitality AI evaluation dataset — 20+ realistic questions across
    operations, revenue, management, actions, and security categories; agent
    must pass before release.
17. Documentation: `/docs/ai/ARCHITECTURE.md`, `/docs/ai/TOOLS.md`,
    `/docs/ai/SECURITY.md`, `/docs/ai/EVALUATION.md`, plus README updates.

## Environment variables

Use the project's existing conventions. Conceptually:

```
AI_PROVIDER=
AI_MODEL=
AI_API_KEY=
```

Update `.env.example` with placeholders only. Never commit secrets.

## Scope control — do NOT build in V1 unless already trivial

Autonomous agents, WhatsApp integration, full voice conversation, vector
database / RAG over arbitrary documents, fine‑tuning, AI booking automation,
autonomous financial decisions/refunds/cancellations, multi‑country tax
intelligence, complex forecasting, custom model training.

## Definition of done

An authenticated hotel manager can, from inside InnPilot:

- Ask "What's our occupancy?" → correct answer from real data.
- Ask "How much did we make yesterday?" → correct answer.
- Ask "How is the hotel doing today?" → useful operational summary.
- Ask "Why is revenue lower this week?" → data‑backed analysis using multiple tools.
- Ask "Generate today's report." → structured report.
- Say "Mark Room 204 as dirty." → confirmation request; after confirming,
  the room status actually changes.

All of the above while respecting authentication, authorization, property
isolation, audit logging, input validation, and error handling.

## Final CTO rule

Optimize for **accuracy + safety + usefulness + speed + extensibility**, not
feature count. InnPilot AI V1 should feel like a competent hotel operations
manager sitting inside the existing dashboard — not a generic chatbot bolted
onto a PMS.
