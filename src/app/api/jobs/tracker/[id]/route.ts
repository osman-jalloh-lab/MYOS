import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateApplicationStatus, normalizeStatus, type AppStatus } from "@/lib/appTracker";

const VALID_STATUSES: AppStatus[] = ["Applied", "Needs Reply", "Interview", "Waiting", "Rejected", "Offer", "Unknown"];

/**
 * PATCH /api/jobs/tracker/:id
 * Updates status (and optionally appends notes) for an existing tracked application.
 * Verifies the update landed before returning.
 * Body: { status: AppStatus, notes?: string }
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { status?: string; notes?: string } | null;

  if (!body?.status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  const normalized = normalizeStatus(body.status) as AppStatus;
  if (!VALID_STATUSES.includes(normalized)) {
    return NextResponse.json({ error: `Invalid status. Valid values: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  try {
    const { app, verified } = await updateApplicationStatus(session.user.id, id, normalized, body.notes);
    if (!verified) {
      return NextResponse.json({ error: "Action failed: tracker record was not verified." }, { status: 500 });
    }
    return NextResponse.json({ app, verified });
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (message.includes("not found")) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
