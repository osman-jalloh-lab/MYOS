import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  upsertApplication,
  normalizeStatus,
  normalizeSource,
  createFollowUpTask,
  type AppStatus,
} from "@/lib/appTracker";

/**
 * POST /api/jobs/log
 * Manual "log a job application" endpoint. Intended for quick entry from the
 * dashboard, Telegram, or natural-language chat.
 *
 * Body: {
 *   companyName: string (required)
 *   jobTitle: string (required)
 *   status?: string   — normalized to AppStatus
 *   source?: string   — normalized to AppSource
 *   contactName?: string
 *   contactEmail?: string
 *   notes?: string
 *   jobUrl?: string
 *   location?: string
 *   nextFollowUpDate?: string  — ISO date string
 * }
 *
 * Returns:
 *   { message: "Logged Fairville Construction — IT Support Intern as Needs Reply.",
 *     app: TrackedApp, isNew: boolean, verified: boolean }
 *
 * If verification fails, returns 500 with error message.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, string> | null;
  if (!body?.companyName || !body?.jobTitle) {
    return NextResponse.json(
      { error: "companyName and jobTitle are required. Tip: include status, source, contactName, notes." },
      { status: 400 }
    );
  }

  const status = body.status ? (normalizeStatus(body.status) as AppStatus) : "Applied";
  const source = body.source ? normalizeSource(body.source) : "Manual Entry";

  const { app, isNew, verified } = await upsertApplication(session.user.id, {
    companyName: body.companyName,
    jobTitle: body.jobTitle,
    status,
    source,
    contactName: body.contactName,
    contactEmail: body.contactEmail,
    notes: body.notes,
    jobUrl: body.jobUrl,
    location: body.location,
    nextFollowUpDate: body.nextFollowUpDate ? new Date(body.nextFollowUpDate) : undefined,
    applicationDate: new Date(),
  });

  if (!verified) {
    return NextResponse.json({ error: "Action failed: tracker record was not verified." }, { status: 500 });
  }

  // Always create a follow-up task for manual entries
  await createFollowUpTask(
    session.user.id,
    app,
    status === "Needs Reply" ? "Needs Reply" : status === "Interview" ? "Interview Request" : "Application Confirmation"
  ).catch(() => {}); // non-fatal

  const verb = isNew ? "Logged" : "Updated";
  const message = `${verb} ${app.companyName} — ${app.jobTitle} as ${app.status}.`;

  return NextResponse.json({ message, app, isNew, verified }, { status: isNew ? 201 : 200 });
}
