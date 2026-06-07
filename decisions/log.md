# Decisions log

## 2026-06-06 — Phase 2 complete: Argus daily brief (Groq-routed synthesis), verified live
Built and verified end-to-end: src/lib/modelRouter.ts (callGroq against Groq's OpenAI-
compatible chat completions endpoint, model llama-3.1-8b-instant, model_usage logging per
CLAUDE.md rule 4), src/agents/argus.ts (synthesize aggregates Kairos calendar signals + Iris
inbox triage; riskFlag is a heuristic phishing/scam phrase scan, no LLM; anomalyWatch flags
conflict_spike/unread_spike/back_to_back via thresholds, no LLM; morningBrief synthesizes
via Groq, dataClass PRIVATE, and upserts into daily_briefs), /api/brief endpoint (auth-gated),
and cron/daily-brief rewritten to run morningBrief for every user via Promise.allSettled.
Live test against the real DB and a real GROQ_API_KEY confirmed: GET /api/brief returned 200
with a generated brief, a daily_briefs row persisted, and a model_usage row logged
(provider: groq, taskType: daily-brief, dataClass: PRIVATE, ~$0.000015 est. cost). No LLM call
touches risk-flagging or anomaly detection — both stay heuristic per Argus's read-only,
no-action-tools role. Build passes clean (12 routes). Owner: Osman Jalloh.

## 2026-06-06 — Phase 3 (partial, by request): Gmail read-only + Iris triage
Added gmail.readonly scope to both OAuth flows (primary sign-in in auth.ts and the
account-link flow); existing linked accounts must re-consent once. Built src/lib/gmail.ts
(cross-account metadata-only fetch via Promise.allSettled, heuristic classify, triage) and
wired Iris's tools (gmail.read, classify, triage, draft-reply) in src/agents/iris.ts.
/api/email endpoint added. draft-reply writes a pending ApprovalAction (draft_email) row —
it never touches the Gmail API. Deliberately did NOT request gmail.compose/gmail.send:
no write power until the Phase 4 approval queue exists, per CLAUDE.md rule 3. Build passes
clean (11 routes). Owner: Osman Jalloh.

## 2026-06-06 — Phase 1 (Stage 2 + 3) complete: multi-account OAuth, calendar aggregation
Built: server-side OAuth via NextAuth v5 with jwt/session callbacks persisting tokens to
GoogleAccount table; AES-256-GCM token encryption (TOKEN_ENCRYPTION_KEY); token refresh
logic; account link/disconnect endpoints; cross-account calendar aggregation (Kairos tools);
/api/calendar endpoint. Initial Prisma migration (20260606192609_init) applied. Prisma 7
config moved to prisma.config.ts. Build passes clean (10 routes). No Gmail scopes — Phase 3.
No send/delete/write — Phase 4 approval queue. Waiting for Stage 4 go-ahead.
Owner: Osman Jalloh.

## 2026-06-06 — Stage 1 confirmed: product summary, 7-agent roster, no-overlap rationale
Claude Code read HERMES_OS_MASTER_SPEC.md v3.0 in full. Confirmed: (1) one-paragraph product
summary matches spec, (2) all 7 agents and their private tools enumerated correctly,
(3) overlap is impossible because tools are assigned exclusively — each tool appears in exactly
one agent's list. No app code written. Waiting for Stage 2 go-ahead.
Owner: Osman Jalloh.

## 2026-06-05 — Hermes OS, Vercel, single-spec, 7 non-overlapping agents
Build Hermes as a Next.js app on Vercel (Turso, NextAuth v5, Prisma), built locally in
VS Code with Claude Code. One orchestrator (Hermes) + six specialists (Iris/email,
Kairos/calendar, Argus/sentinel-brief, Plutus/finance, Athena/jobs+resume, Mnemosyne/memory).
Each agent owns one domain and only its own tools. Default model provider: Groq (Lean).
HERMES_OS_MASTER_SPEC.md is the single source of truth.
