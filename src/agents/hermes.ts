// Hermes — orchestration
// Owns ONLY these tools (this is what enforces no-overlap): "model-router","approval-queue","a2a-handoff","decisions-log","skill-registry","skill-match"
// CAN: route tasks, pick model, match skills, gate every write
// CANNOT: read raw data itself; it delegates

import { prisma } from "@/lib/db";
import {
  listApprovals,
  approveAction,
  rejectAction,
  createApproval,
  approvalCounts,
  type ApprovalActionType,
  type ApprovalStatus,
} from "@/lib/approvals";
import { callModel } from "@/lib/modelRouter";
import { calendarRead } from "@/agents/kairos";
import { triageInbox } from "@/agents/iris";
import { morningBrief } from "@/agents/argus";
import { plutusReport } from "@/agents/plutus";
import { appTrackerSummary } from "@/agents/athena";
import { getContextCards } from "@/agents/mnemosyne";

export const hermes = {
  name: "Hermes",
  domain: "orchestration",
  tools: ["model-router", "approval-queue", "a2a-handoff", "decisions-log", "skill-registry", "skill-match"] as const,
};

// ── approval-queue ────────────────────────────────────────────────────────────
// The single gate every other agent's proposed write passes through. No agent
// calls Gmail/Calendar/job-board write APIs directly — they call propose,
// Hermes logs it as "pending", and only Osman's click moves it forward.

export const approvalQueue = {
  propose: createApproval,
  list: listApprovals,
  counts: approvalCounts,
  approve: approveAction,
  reject: rejectAction,
};

// ── a2a-handoff ───────────────────────────────────────────────────────────────
// Agent-to-agent handoff log. Every cross-agent call (e.g. Argus reading
// Kairos + Iris output, Athena asking Mnemosyne for context) is recorded as an
// AgentRun row so the dashboard can show what ran, when, and with what model.

export async function logHandoff(params: {
  agentName: string;
  inputSummary?: string;
  outputSummary?: string;
  modelProvider?: string;
  status?: "completed" | "failed";
}): Promise<void> {
  await prisma.agentRun.create({
    data: {
      agentName: params.agentName,
      inputSummary: params.inputSummary,
      outputSummary: params.outputSummary,
      modelProvider: params.modelProvider,
      status: params.status ?? "completed",
    },
  });
}

export interface RecentRun {
  id: string;
  agentName: string;
  inputSummary: string | null;
  outputSummary: string | null;
  modelProvider: string | null;
  status: string;
  createdAt: string;
}

export async function recentRuns(limit = 20): Promise<RecentRun[]> {
  const rows = await prisma.agentRun.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id,
    agentName: r.agentName,
    inputSummary: r.inputSummary,
    outputSummary: r.outputSummary,
    modelProvider: r.modelProvider,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ── decisions-log ─────────────────────────────────────────────────────────────

export async function logDecision(title: string, decision: string, reason?: string): Promise<void> {
  await prisma.decisionLog.create({ data: { title, decision, reason } });
}

export interface DecisionEntry {
  id: string;
  title: string;
  decision: string;
  reason: string | null;
  createdAt: string;
}

export async function recentDecisions(limit = 10): Promise<DecisionEntry[]> {
  const rows = await prisma.decisionLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    decision: r.decision,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ── skill-registry / skill-match ──────────────────────────────────────────────
// Lightweight keyword matcher standing in for the full registry (reading and
// parsing skill files from SKILL_REGISTRY_PATH is a later increment). This
// documents the tool's shape so other agents can call it without Hermes
// reaching into their domains.

export interface SkillMatch {
  skill: string;
  reason: string;
}

const KNOWN_SKILLS: Record<string, string[]> = {
  "resume-tailor": ["resume", "ats", "cover letter", "job description"],
  "email-triage": ["inbox", "unread", "triage", "classify"],
  "calendar-conflict": ["conflict", "overlap", "double booked", "schedule"],
  "finance-budget": ["budget", "spend", "cost", "debt"],
};

export function matchSkills(query: string): SkillMatch[] {
  const q = query.toLowerCase();
  const matches: SkillMatch[] = [];
  for (const [skill, keywords] of Object.entries(KNOWN_SKILLS)) {
    const hit = keywords.find((k) => q.includes(k));
    if (hit) matches.push({ skill, reason: `matched keyword "${hit}"` });
  }
  return matches;
}

// ── routeMessage ──────────────────────────────────────────────────────────────
// Single entry point for "talk to Hermes" — shared by the dashboard chat
// (/api/chat) and the Telegram bridge (/api/telegram/webhook), so intent
// routing lives in exactly one place regardless of which client sent the text.
//
// It does two kinds of things, and ONLY two:
//   1. Approval verbs ("approve <id>" / "reject <id>") — calls the existing
//      approval-queue functions. This is Hermes's only "write" surface, and it
//      is the SAME path the dashboard's /approvals page already uses — chat is
//      just another client of the queue, never a way around it.
//   2. Everything else — read-only signal gathering from the other agents'
//      already-existing read tools, then a Groq-synthesized reply. No agent's
//      write tools are reachable from here.

export interface RouteResult {
  reply: string;
  approvalAction?: { id: string; actionType: string; status: string };
  pendingApprovals?: { id: string; actionType: string }[];
}

const HERMES_CHAT_SYSTEM_PROMPT = `You are Hermes, Osman Jalloh's personal-assistant
orchestrator. You speak in short, direct, conversational replies (this is chat, not
a report). You only know what's in the context block you're given for this message —
if it's empty or doesn't cover the question, say plainly that you don't have that
data rather than guessing. You never claim to have sent an email, booked a meeting,
applied to a job, or changed anything — those all require Osman's approval through
the queue, and you only ever propose, never execute, sensitive actions.`;

interface ContextMatcher {
  match: RegExp;
  taskType: string;
  load: (userId: string, query: string) => Promise<string>;
}

const CONTEXT_MATCHERS: ContextMatcher[] = [
  {
    match: /calendar|schedule|meeting|event|agenda|free time|busy/,
    taskType: "chat-calendar",
    load: async (userId) => {
      const now = new Date();
      const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const events = await calendarRead(userId, now, weekOut);
      return `Calendar events for the next 7 days: ${JSON.stringify(events.slice(0, 10))}`;
    },
  },
  {
    match: /inbox|email|unread|gmail/,
    taskType: "chat-email",
    load: async (userId) => `Inbox triage: ${JSON.stringify(await triageInbox(userId))}`,
  },
  {
    match: /spend|budget|finance|debt|cost|money|expense/,
    taskType: "chat-finance",
    load: async (userId) => `Finance snapshot: ${JSON.stringify(await plutusReport(userId))}`,
  },
  {
    match: /job|career|application|resume|interview|hiring/,
    taskType: "chat-jobs",
    load: async (userId) => `Job application tracker: ${JSON.stringify(await appTrackerSummary(userId))}`,
  },
  {
    match: /remember|memory|recall|fact about me/,
    taskType: "chat-memory",
    load: async (userId, query) => `Relevant remembered facts: ${JSON.stringify(await getContextCards(userId, query))}`,
  },
  {
    match: /brief|today|what's up|whats up|overview|summary/,
    taskType: "chat-brief",
    load: async (userId) => `Today's synthesized brief: ${(await morningBrief(userId)).text}`,
  },
  {
    match: /approval|pending|queue|waiting on me/,
    taskType: "chat-approvals",
    load: async (userId) => {
      const [counts, pending] = await Promise.all([approvalCounts(userId), listApprovals(userId, "pending")]);
      return `Pending approval counts: ${JSON.stringify(counts)}. Pending items: ${JSON.stringify(pending.slice(0, 10))}`;
    },
  },
  {
    match: /skill|sophos|new tools?|capabilit|what's new|whats new/,
    taskType: "chat-skills",
    load: async () => {
      const latest = await prisma.agentRun.findFirst({
        where: { agentName: "sophos" },
        orderBy: { createdAt: "desc" },
      });
      return latest
        ? `Sophos's most recent skill brief (${latest.createdAt.toISOString().slice(0, 10)}): ${latest.outputSummary}`
        : "Sophos hasn't run a skill brief yet — nothing to report from it.";
    },
  },
];

function buildContext(q: string): ContextMatcher | null {
  return CONTEXT_MATCHERS.find((m) => m.match.test(q)) ?? null;
}

export async function routeMessage(userId: string, text: string): Promise<RouteResult> {
  const trimmed = text.trim();
  const approvalVerb = trimmed.match(/^(approve|reject)\s+([a-zA-Z0-9-]+)/i);

  if (approvalVerb) {
    const [, verb, id] = approvalVerb;
    const isApprove = verb.toLowerCase() === "approve";
    try {
      const action = isApprove ? await approveAction(userId, id) : await rejectAction(userId, id);
      const reply = isApprove
        ? `Approved "${action.actionType}" (${action.id.slice(0, 8)}). Status: ${action.status}.`
        : `Rejected "${action.actionType}" (${action.id.slice(0, 8)}).`;
      return { reply, approvalAction: { id: action.id, actionType: action.actionType, status: action.status } };
    } catch (err) {
      const message = (err as Error).message ?? "";
      const reason = message.includes("No record was found")
        ? `I don't see a pending action with id "${id}" — check the id from the approvals list and try again.`
        : message.includes("already")
          ? message.match(/already \w+/)?.[0] ?? "it's already been resolved."
          : "something went wrong on my end resolving that — try again from the dashboard's approvals page.";
      return { reply: `Couldn't ${verb} "${id}": ${reason}` };
    }
  }

  const q = trimmed.toLowerCase();
  const matched = buildContext(q);
  const context = matched ? await matched.load(userId, trimmed) : "";

  const result = await callModel({
    userId,
    taskType: matched?.taskType ?? "chat-general",
    dataClass: "PERSONAL",
    systemPrompt: HERMES_CHAT_SYSTEM_PROMPT,
    userPrompt: context
      ? `Context for this reply:\n${context}\n\nOsman just asked: "${trimmed}"\n\nReply in 2-4 sentences, conversationally, grounded only in the context above.`
      : `Osman just asked: "${trimmed}"\n\nI have no specific data context loaded for this message. Reply briefly — if the question sounds like it needs data (calendar, email, finance, jobs, memory, approvals, brief), say you didn't catch a topic you can look up and name the topics you can check. Otherwise just answer conversationally.`,
  });

  await logHandoff({
    agentName: "hermes",
    inputSummary: trimmed.slice(0, 200),
    outputSummary: result.text.slice(0, 500),
    modelProvider: result.provider,
  });

  // Surface pending items as structured data too — Telegram attaches inline
  // Approve/Reject buttons to them; the dashboard chat just shows the reply text.
  if (matched?.taskType === "chat-approvals") {
    const pending = await listApprovals(userId, "pending");
    return {
      reply: result.text,
      pendingApprovals: pending.slice(0, 5).map((p) => ({ id: p.id, actionType: p.actionType })),
    };
  }

  return { reply: result.text };
}

export type { ApprovalActionType, ApprovalStatus };
