# Hermes OS — Phase 8 Expansion Plan

Status: DRAFT — for Osman's review before any code changes. Phases 1-7 are complete
and live (see `decisions/log.md`, 2026-06-07 entry). This plan covers the next round
of work Osman asked for in conversation. It expands the architecture beyond the
original 7-agent spec, so `docs/HERMES_OS_MASTER_SPEC.md` and `CLAUDE.md` need an
explicit amendment before build starts (see "Spec amendments required" below).

Each numbered section below is a buildable, independently-shippable unit. STOP after
each and confirm before moving to the next — same discipline as Phases 1-7.

---

## 1. Telegram bridge — talk to Hermes from Telegram

**Goal:** Osman can message a Telegram bot to check status, assign tasks, and approve/
reject queued actions, without opening the dashboard.

**Design:**
- New file `src/lib/telegram.ts` — thin wrapper over the Telegram Bot HTTP API
  (`sendMessage`, `setWebhook`, `answerCallbackQuery` for inline approve/reject buttons).
  No SDK dependency needed; it's a handful of `fetch` calls.
- New route `src/app/api/telegram/webhook/route.ts` — receives Telegram updates via
  webhook (POST). Verifies the request (Telegram's secret-token header), maps the
  sender's Telegram user ID to Osman's Hermes `userId` (single-user system, so this is
  a static mapping via `TELEGRAM_OWNER_CHAT_ID` env var — anything from another chat ID
  is ignored).
- Message handling, routed through Hermes (the orchestrator already owns
  `a2a-handoff` and `skill-match`):
  - Plain text → goes to Hermes for intent classification → routes to the right
    agent's read tools (e.g. "what's on my calendar today" → Kairos calendar.read,
    "how's my spend this month" → Plutus finance.read) and replies with a synthesized
    answer (Groq call, logged to `model_usage` like everything else).
  - "approve N" / "reject N" / inline button taps → calls the existing
    `/api/approvals/[id]` POST handler. **No new write path** — Telegram is just
    another client of the same approval queue. This is the part that matters most:
    it must not become a side door that bypasses approvals.
  - Task assignment ("remind me to X", "track this job: Y") → creates rows the same
    way the dashboard does (`Task`, `JobListing`) — through existing lib functions,
    not new write paths.
- Env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`.
  **Token goes in `.env.local` only — never committed, never printed.** (CLAUDE.md rule 1.)
- Outbound notifications: when an `ApprovalAction` is created, optionally ping Osman's
  Telegram chat with a one-line summary + inline Approve/Reject buttons. This is the
  main "talk to it" loop closing — Hermes proposes, Telegram is where Osman decides.

**What this does NOT do:** it does not let Telegram messages directly trigger
`send_email` / `apply_to_job` / etc. Those stay `SCOPE_BLOCKED` exactly as they are now;
Telegram can only approve/reject what's already in the queue, same as the dashboard.

**Open item:** webhook needs a public HTTPS URL. In local dev that means a tunnel
(e.g. `ngrok` or Cloudflare Tunnel) pointed at `localhost:3000/api/telegram/webhook`;
in production it's just the Vercel deployment URL. We'll need to decide dev-vs-prod
webhook registration when we get here.

---

## 2. Dashboard chat — talk to Hermes from the web UI

**Goal:** A chat panel on the dashboard that does the same thing as the Telegram
bridge (ask questions, get routed answers, approve/reject inline) — just from the browser.

**Design:**
- New route `src/app/api/chat/route.ts` — POST `{ message }`, auth-gated. Runs the
  exact same Hermes intent-routing path the Telegram bridge uses (shared function in
  `src/agents/hermes.ts`, e.g. `routeMessage(userId, text)`), so there's one source of
  truth for "what Hermes does with a message" regardless of which client sent it.
- New component on `src/app/page.tsx` (or a dedicated `/chat` route) — a simple
  message list + input box, calling `/api/chat`, rendering Hermes's replies and any
  inline approve/reject affordances (which POST to `/api/approvals/[id]` — the
  existing endpoint, no new write path here either).
- Chat history: a lightweight `ChatMessage` table (userId, role, content, createdAt) so
  the conversation persists across refreshes — purely a log, no model context window
  management needed at this scale (single user, low volume).

**Shared core:** Sections 1 and 2 both reduce to "build `Hermes.routeMessage()` once,
expose it over two transports (Telegram webhook, dashboard chat API)." That's the
right shape — avoids building the same intent-routing logic twice.

---

## 3. Athena gets real job-board data via MCP connectors

**Current state:** Athena's `job-search`/`app-tracker` are a manually-curated DB ledger
(`JobListing`) because no job-board API keys exist in `.env.local`. `github-scout` is
the one live external signal source (free public GitHub search API).

**What's actually available right now:** Your Claude.ai MCP connections include
**Indeed** (`search_jobs`, `get_job_details`, `get_company_data`, `get_resume`) and
**ZipRecruiter** (`search_jobs`). I don't see an Apify connector in your current MCP
list — if you have one configured elsewhere, point me at it and I'll wire it in the
same way; otherwise this plan covers Indeed + ZipRecruiter, which cover the core need
(real postings instead of a manual ledger).

**Design:**
- New file `src/lib/jobBoards.ts` — wraps the Indeed and ZipRecruiter MCP tool calls
  behind a normalized interface (`searchJobBoards(query, location?) → NormalizedListing[]`),
  so Athena's agent code doesn't care which board a result came from.
- Extend `src/agents/athena.ts`'s `jobSearch` tool: instead of only reading
  `JobListing` rows, it also calls `searchJobBoards` and returns a merged view —
  external results the user can choose to "track" (which creates a `JobListing` row,
  same as today).
- Rewrite the `job-scout` cron (currently: re-scores already-tracked roles) to
  *additionally* run `searchJobBoards` against Osman's target roles (GRC/security
  analyst etc.), surfacing new postings as `AgentRun` output for review — **never**
  auto-creating `JobListing` rows or auto-applying. Surfacing only; tracking and
  applying stay manual/approval-gated per master-spec section 7 ("never fully
  automate ... job applications").
- Data classification: job posting text from external boards is PUBLIC data — fine to
  route through Groq per the existing data-routing table; no change to `callModel` needed.

**What this does NOT do:** it does not add `apply_to_job` execution. That action type
already exists in the approval queue as `SCOPE_BLOCKED` (held until Osman explicitly
authorizes auto-apply, which master-spec section 7 says should never be fully automatic).

---

## 4. Dashboard UI/UX redesign

**Goal:** A visual refresh of the dashboard — you confirmed this means reworking the
look and feel of the existing Next.js dashboard (not a separate tool/brand called "GX").

**Approach:** Before touching code, I'd want to:
1. See or describe a reference look (a site/app whose visual language you like, or
   a rough description: darker/lighter, denser/airier, more cards vs. more tables, etc.)
2. Decide scope: full visual system pass (palette, type scale, spacing, component
   library) vs. targeted polish (the new Plutus/Athena/Mnemosyne panels feel bolted-on
   and could use the most attention).

I'd load the `frontend-design` and `design-system` skills for this pass once we scope
it — this section is intentionally light until we align on direction, since redesign
work is highly taste-driven and I'd rather not guess and redo.

---

## 5. Sophos — new 8th agent: skills innovator/scout

**Goal:** An agent that watches Claude/Anthropic release notes, GitHub trending repos,
and YouTube channels relevant to Osman's GRC/security/AI direction, and proactively
surfaces "this might help you" suggestions — new skills, tools, techniques.

**Spec amendment required:** CLAUDE.md currently states "The 7 agents (each owns ONE
domain...)" with tools owned exclusively. Adding an 8th agent is a deliberate departure
from the original spec — I'd update both `docs/HERMES_OS_MASTER_SPEC.md` and
`CLAUDE.md` to register Sophos and its tools before writing any agent code, so the
"single source of truth" stays true. This is a quick edit, but it's a real change to
a document Osman explicitly said is authoritative — flagging it rather than quietly
expanding scope.

**Proposed tools (owned exclusively by Sophos, no overlap with existing 7):**
- `release-watch` — checks Anthropic/Claude release notes and changelogs (via web
  search/fetch) for new capabilities relevant to Osman's stack
- `repo-scout` — searches GitHub (same free public API github-scout already uses, but
  scoped to *tooling/skills* repos rather than job-relevant company repos — these are
  different queries serving different agents' purposes, which is why this isn't just
  "give Athena's github-scout to Sophos")
- `video-digest` — surfaces relevant YouTube videos by channel/topic (via YouTube Data
  API — **needs an API key**, which doesn't currently exist in `.env.local`; this is a
  blocker to flag now rather than discover mid-build)
- `skill-brief` — synthesizes findings into a short "here's what's new and why it
  might matter to you" digest (Groq call, logged to `model_usage`, PUBLIC data)

**Output path:** Sophos never installs or applies anything — it only produces
digests. Delivery is via the existing surfaces: an `AgentRun` row (visible on the
dashboard) and optionally a Telegram ping (once section 1 exists) summarizing new
findings on a schedule (new cron: `cron/skills-scout`, weekly).

**Open item:** `video-digest` needs a YouTube Data API key (`YOUTUBE_API_KEY`) that
doesn't exist yet — either get one (Google Cloud Console, free tier) or scope
`video-digest` down to channel-RSS-feed polling (no key needed, but less rich search).

---

## Build order (recommended)

This order front-loads the piece every other piece depends on (shared message routing),
then ships the highest-value, lowest-risk items first:

1. **Hermes.routeMessage() core** + **Dashboard chat** (section 2) — ships a usable
   "talk to it" loop entirely within the existing web app, no external services, no new
   tokens needed. Proves the routing logic works before wiring a second transport to it.
2. **Telegram bridge** (section 1) — reuses the routing core from step 1; this is where
   your bot token gets wired in (`.env.local` only).
3. **Athena MCP connectors** (section 3) — Indeed + ZipRecruiter via your existing
   Claude.ai MCP connections; real postings replace the manual-ledger-only flow.
4. **Sophos** (section 5) — requires the CLAUDE.md/master-spec amendment first; then
   release-watch + repo-scout ship without blockers, video-digest waits on a YouTube
   API key decision.
5. **Dashboard redesign** (section 4) — last, since it's the most taste-driven and
   benefits from having the chat panel and new agent panels already in place to design
   *around* rather than redoing twice.

---

## Spec amendments required before section 5

- `docs/HERMES_OS_MASTER_SPEC.md`: register Sophos as an 8th agent with its tool list.
- `CLAUDE.md`: update "The 7 agents" heading and roster to include Sophos, confirm
  tool-exclusivity still holds (it does — `release-watch`/`repo-scout`/`video-digest`/
  `skill-brief` don't overlap any existing agent's tools).

## Things this plan deliberately does NOT change

- The approval queue remains the only path to any send/write/delete action
  (CLAUDE.md rule 3) — Telegram and dashboard chat are new *clients* of it, not new
  paths around it.
- `apply_to_job`, `send_email`, etc. stay `SCOPE_BLOCKED`.
- Osman's writing rules (no em dashes, no "excited to apply", Security+/CySA+ near top,
  drafts FROM osman.jalloh@g.austincc.edu) apply to anything Sophos or Athena drafts.

---

Owner: Osman Jalloh. Drafted by Claude Code, 2026-06-07, pending review.
