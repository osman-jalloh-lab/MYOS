// Vercel Cron: daily-brief. Schedule defined in vercel.json (UTC).
// Generates and persists today's brief for every user via Argus.morningBrief —
// pure read/synthesize, nothing writes to external systems (no send/approval needed).
import { prisma } from "@/lib/db";
import { morningBrief } from "@/agents/argus";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const users = await prisma.user.findMany({ select: { id: true, primaryEmail: true } });

  const results = await Promise.allSettled(
    users.map(async (user) => {
      await morningBrief(user.id);
      return user.primaryEmail;
    })
  );

  const generated = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);
  const failed = results
    .map((r, i) => (r.status === "rejected" ? users[i].primaryEmail : null))
    .filter((email): email is string => email !== null);

  return Response.json({ ok: true, job: "daily-brief", generated, failed });
}
