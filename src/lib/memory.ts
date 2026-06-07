// Memory data layer for Mnemosyne. Mnemosyne never writes to Memory directly —
// every save or delete is proposed as an ApprovalAction (save_memory /
// delete_memory) and only lands once Osman approves it, per master-spec
// section 3 ("Can't: save or delete memory without Osman's approval").
import { prisma } from "./db";
import { createApproval } from "./approvals";

export interface MemoryView {
  id: string;
  fact: string;
  source: string | null;
  approvedAt: string | null;
  createdAt: string;
}

function toView(row: { id: string; fact: string; source: string | null; approvedAt: Date | null; createdAt: Date }): MemoryView {
  return {
    id: row.id,
    fact: row.fact,
    source: row.source,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** memory.read — lists approved memory entries, most recent first. */
export async function memoryRead(userId: string): Promise<MemoryView[]> {
  const rows = await prisma.memory.findMany({
    where: { userId, approvedAt: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toView);
}

/** memory-suggest — proposes a fact worth remembering; queues a save_memory approval. */
export async function memorySuggest(userId: string, fact: string, source?: string) {
  return createApproval(userId, "save_memory", { fact, source: source ?? "memory-suggest" });
}

/** onboarding-memory — same gate, tagged so the queue shows the onboarding context. */
export async function onboardingMemory(userId: string, fact: string, place: string) {
  return createApproval(userId, "save_memory", { fact, source: `onboarding:${place}` });
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are", "at", "his", "her", "my",
]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export interface ContextCard {
  fact: string;
  source: string | null;
  relevance: number;
}

/**
 * context-cards — surfaces the memory entries most relevant to a query string
 * via simple keyword overlap (no LLM call needed; memory facts are short and
 * this stays cheap and fast for a sidebar widget).
 */
export async function contextCards(userId: string, query: string, max = 5): Promise<ContextCard[]> {
  const facts = await memoryRead(userId);
  const queryWords = new Set(keywords(query));
  if (queryWords.size === 0) {
    return facts.slice(0, max).map((f) => ({ fact: f.fact, source: f.source, relevance: 0 }));
  }

  return facts
    .map((f) => {
      const factWords = keywords(f.fact);
      const overlap = factWords.filter((w) => queryWords.has(w)).length;
      return { fact: f.fact, source: f.source, relevance: overlap };
    })
    .sort((a, b) => b.relevance - a.relevance)
    .filter((c) => c.relevance > 0)
    .slice(0, max);
}

const STALE_DAYS = 120;

export interface StaleCandidate {
  id: string;
  fact: string;
  source: string | null;
  ageDays: number;
}

/**
 * stale-cleanup — finds memory entries older than STALE_DAYS and proposes a
 * delete_memory approval for each. Never deletes directly.
 */
export async function staleCleanup(userId: string): Promise<StaleCandidate[]> {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.memory.findMany({
    where: { userId, approvedAt: { not: null }, createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
  });

  const candidates: StaleCandidate[] = stale.map((m) => ({
    id: m.id,
    fact: m.fact,
    source: m.source,
    ageDays: Math.floor((Date.now() - m.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
  }));

  const pending = await prisma.approvalAction.findMany({
    where: { userId, actionType: "delete_memory", status: { in: ["pending", "approved"] } },
  });
  const alreadyProposed = new Set(
    pending
      .map((p) => {
        try {
          return (JSON.parse(p.payload) as { memoryId?: string }).memoryId;
        } catch {
          return undefined;
        }
      })
      .filter(Boolean)
  );

  for (const c of candidates.filter((c) => !alreadyProposed.has(c.id))) {
    await createApproval(userId, "delete_memory", {
      memoryId: c.id,
      fact: c.fact,
      reason: `Untouched for ${c.ageDays} days — proposed for cleanup, not removed automatically.`,
    });
  }

  return candidates;
}
