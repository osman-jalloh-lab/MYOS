import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  listApplications,
  upsertApplication,
  applicationSummary,
  normalizeStatus,
  normalizeSource,
  type AppStatus,
} from "@/lib/appTracker";

/**
 * GET /api/jobs/tracker?status=Needs+Reply
 * Returns all tracked applications (optionally filtered), plus pipeline counts
 * and urgent items (Needs Reply, Interview).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const statusParam = new URL(req.url).searchParams.get("status");
  const status = statusParam ? normalizeStatus(statusParam) : undefined;

  const [applications, summary] = await Promise.all([
    listApplications(session.user.id, { status: status as AppStatus | undefined }),
    applicationSummary(session.user.id),
  ]);

  return NextResponse.json({ applications, summary });
}

/**
 * POST /api/jobs/tracker
 * Creates or updates a tracked application. Verifies the write landed.
 * Body: TrackedAppInput fields.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, string> | null;
  if (!body?.companyName || !body?.jobTitle) {
    return NextResponse.json({ error: "companyName and jobTitle are required" }, { status: 400 });
  }

  const { app, isNew, verified } = await upsertApplication(session.user.id, {
    companyName: body.companyName,
    jobTitle: body.jobTitle,
    source: body.source ? normalizeSource(body.source) : undefined,
    status: body.status ? normalizeStatus(body.status) as AppStatus : undefined,
    contactName: body.contactName,
    contactEmail: body.contactEmail,
    emailSubject: body.emailSubject,
    jobUrl: body.jobUrl,
    location: body.location,
    notes: body.notes,
    applicationDate: body.applicationDate ? new Date(body.applicationDate) : undefined,
    nextFollowUpDate: body.nextFollowUpDate ? new Date(body.nextFollowUpDate) : undefined,
    gmailMessageId: body.gmailMessageId,
  });

  if (!verified) {
    return NextResponse.json({ error: "Action failed: tracker record was not verified." }, { status: 500 });
  }

  return NextResponse.json({ app, isNew, verified }, { status: isNew ? 201 : 200 });
}
