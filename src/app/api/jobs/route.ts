import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { jobSearchTool, trackJob, appTrackerSummary } from "@/agents/athena";
import type { JobStatus } from "@/lib/jobs";

const VALID_STATUSES: JobStatus[] = ["interested", "applied", "interview", "offer", "rejected", "archived"];

/**
 * GET /api/jobs?status=interested
 * Lists Athena's tracked roles (optionally filtered) plus pipeline counts —
 * the read side of job-search and app-tracker. Athena never applies; this is
 * Osman's own ledger of roles he's watching.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusParam = new URL(req.url).searchParams.get("status");
  const status =
    statusParam && VALID_STATUSES.includes(statusParam as JobStatus)
      ? (statusParam as JobStatus)
      : undefined;

  const [listings, tracker] = await Promise.all([
    jobSearchTool(session.user.id, status),
    appTrackerSummary(session.user.id),
  ]);

  return NextResponse.json({ listings, tracker });
}

/**
 * POST /api/jobs — logs a role Osman wants Athena to track and score.
 * Body: { title, company, url?, notes? }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { title?: string; company?: string; url?: string; notes?: string }
    | null;

  if (!body?.title || !body?.company) {
    return NextResponse.json({ error: "title and company are required" }, { status: 400 });
  }

  const listing = await trackJob(session.user.id, {
    title: body.title,
    company: body.company,
    url: body.url,
    notes: body.notes,
  });

  return NextResponse.json({ listing }, { status: 201 });
}
