import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { morningBrief } from "@/agents/argus";

/**
 * GET /api/brief
 * Generates (or regenerates) today's morning brief for the signed-in user via
 * Argus, persists it to daily_briefs, and returns it. Synthesizes Kairos's
 * calendar signals and Iris's inbox triage through the Groq-routed model call.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const brief = await morningBrief(session.user.id);
  return NextResponse.json(brief);
}
