import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listApprovals, approvalCounts, type ApprovalStatus } from "@/lib/approvals";

const VALID_STATUSES: ApprovalStatus[] = ["pending", "approved", "rejected", "executed"];

/**
 * GET /api/approvals?status=pending
 * Lists this user's approval-queue rows (optionally filtered by status) plus
 * counts by status for the queue badge. Every write any agent proposes lands
 * here first — this is the read side of Hermes's approval-gate tool.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusParam = new URL(req.url).searchParams.get("status");
  const status =
    statusParam && VALID_STATUSES.includes(statusParam as ApprovalStatus)
      ? (statusParam as ApprovalStatus)
      : undefined;

  const [actions, counts] = await Promise.all([
    listApprovals(session.user.id, status),
    approvalCounts(session.user.id),
  ]);

  return NextResponse.json({ actions, counts });
}
