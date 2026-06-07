import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { githubScout } from "@/agents/athena";

/**
 * GET /api/github-scout?q=grc+compliance+tooling
 * Read-only public-repo search (Athena's github-scout tool). PUBLIC data,
 * no auth token, no writes — just a signal feed for Osman to skim.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q query param is required" }, { status: 400 });
  }

  try {
    const repos = await githubScout(q);
    return NextResponse.json({ query: q, repos });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "GitHub search failed" }, { status: 502 });
  }
}
