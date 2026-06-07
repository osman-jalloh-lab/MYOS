import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readMemory, suggestMemory, getContextCards, runStaleCleanup } from "@/agents/mnemosyne";

/**
 * GET /api/memory                — list approved memory entries (memory.read)
 * GET /api/memory?q=ut+system    — relevant context cards for a query
 * GET /api/memory?cleanup=1      — proposes delete_memory approvals for stale facts
 *
 * All writes (suggest/cleanup) only ever queue ApprovalAction rows — Mnemosyne
 * cannot save or delete a memory directly, per master-spec section 3.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const cleanup = url.searchParams.get("cleanup");

  if (cleanup) {
    const proposed = await runStaleCleanup(userId);
    return NextResponse.json({ proposed });
  }

  if (q) {
    const cards = await getContextCards(userId, q);
    return NextResponse.json({ query: q, cards });
  }

  const memories = await readMemory(userId);
  return NextResponse.json({ memories });
}

/**
 * POST /api/memory — proposes a fact worth remembering (memory-suggest).
 * Body: { fact: string, source?: string }
 * Queues a save_memory ApprovalAction; lands in Memory only once approved.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { fact?: string; source?: string } | null;
  if (!body?.fact) {
    return NextResponse.json({ error: "fact is required" }, { status: 400 });
  }

  const proposal = await suggestMemory(session.user.id, body.fact, body.source);
  return NextResponse.json({ proposal }, { status: 201 });
}
