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

export type { ApprovalActionType, ApprovalStatus };
