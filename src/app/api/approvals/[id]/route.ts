import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { approveAction, rejectAction } from "@/lib/approvals";

/**
 * POST /api/approvals/:id  { decision: "approve" | "reject" }
 * The single click-through gate for every proposed write in Hermes OS.
 * Approving attempts execution immediately if (and only if) the underlying
 * capability/scope already exists — otherwise the action stays "approved"
 * with a note explaining what's still missing (see approvals.ts SCOPE_BLOCKED).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { decision?: string };

  if (body.decision !== "approve" && body.decision !== "reject") {
    return NextResponse.json({ error: "decision must be \"approve\" or \"reject\"" }, { status: 400 });
  }

  try {
    const result =
      body.decision === "approve"
        ? await approveAction(session.user.id, id)
        : await rejectAction(session.user.id, id);
    return NextResponse.json({ action: result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 400 });
  }
}
