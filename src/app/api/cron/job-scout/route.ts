// Vercel Cron: job-scout. Schedule defined in vercel.json (weekly, UTC).
// Athena holds no paid job-board API key, so this never invents postings —
// it re-runs fit-score (real Groq calls) over roles Osman has already logged
// to the tracker that include enough notes to score and don't have one yet.
// Pure read + score; nothing gets applied to or messaged without approval.
import { prisma } from "@/lib/db";
import { fitScore } from "@/agents/athena";

const MIN_NOTES_LENGTH = 40;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const candidates = await prisma.jobListing.findMany({
    where: { fitScore: null, status: { in: ["interested", "applied"] } },
  });

  const scoreable = candidates.filter((c) => (c.notes?.length ?? 0) >= MIN_NOTES_LENGTH);

  const results = await Promise.allSettled(
    scoreable.map(async (listing) => {
      const result = await fitScore(listing.userId, {
        jobTitle: listing.title,
        company: listing.company,
        jobDescription: listing.notes!,
        jobListingId: listing.id,
      });
      return { id: listing.id, title: listing.title, company: listing.company, score: result.score };
    })
  );

  const scored = results
    .filter((r): r is PromiseFulfilledResult<{ id: string; title: string; company: string; score: number }> => r.status === "fulfilled")
    .map((r) => r.value);

  await prisma.agentRun.create({
    data: {
      agentName: "athena",
      inputSummary: `job-scout: ${candidates.length} unscored tracked roles, ${scoreable.length} had enough notes to score`,
      outputSummary: scored.map((s) => `${s.title} @ ${s.company}: ${s.score}`).join(" · ").slice(0, 2000),
      status: "completed",
    },
  });

  return Response.json({ ok: true, job: "job-scout", scanned: candidates.length, scored });
}
