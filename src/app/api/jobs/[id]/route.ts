import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { moveJob } from "@/agents/athena";
import type { JobStatus } from "@/lib/jobs";

const VALID_STATUSES: JobStatus[] = ["interested", "applied", "interview", "offer", "rejected", "archived"];

/**
 * POST /api/jobs/:id — moves a tracked role through the pipeline.
 * Body: { status: "interested"|"applied"|"interview"|"offer"|"rejected"|"archived" }
 * This only updates Osman's own ledger — actually applying is gated behind
 * the approval queue ("apply_to_job"), never triggered from here.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { status?: string } | null;

  if (!body?.status || !VALID_STATUSES.includes(body.status as JobStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const listing = await moveJob(session.user.id, id, body.status as JobStatus);
    return NextResponse.json({ listing });
  } catch {
    return NextResponse.json({ error: "Job listing not found" }, { status: 404 });
  }
}
