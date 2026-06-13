import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { backfillFromGmail } from "@/lib/appTracker";
import { sendTelegramMessage } from "@/lib/telegram";

/**
 * POST /api/jobs/backfill
 * Searches Gmail for the last 90 days of job application evidence,
 * creates missing tracker records, and updates existing ones.
 *
 * Returns a summary:
 *   - totalEmailsScanned
 *   - jobEmailsFound
 *   - newApplicationsLogged
 *   - existingRecordsUpdated
 *   - needsUserReview (emails where extraction failed — user can manually log)
 *   - errors
 *
 * This can take 30-60s on large inboxes. Vercel function max is 60s.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Optional: allow passing a custom daysBack (default 90)
  const body = (await req.json().catch(() => null)) as { daysBack?: number } | null;
  const _ = body?.daysBack; // reserved for future parameterization

  try {
    const result = await backfillFromGmail(session.user.id);

    // Notify via Telegram if important items were found
    if (
      (result.newApplicationsLogged > 0 || result.existingRecordsUpdated > 0) &&
      process.env.TELEGRAM_OWNER_CHAT_ID
    ) {
      const urgentCount = result.needsUserReview.length;
      const msg = [
        `Job tracker backfill complete.`,
        `Emails scanned: ${result.totalEmailsScanned}`,
        `Job emails found: ${result.jobEmailsFound}`,
        `New applications logged: ${result.newApplicationsLogged}`,
        `Existing records updated: ${result.existingRecordsUpdated}`,
        urgentCount > 0 ? `Needs manual review: ${urgentCount}` : "",
        result.errors.length > 0 ? `Errors: ${result.errors.length}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await sendTelegramMessage(process.env.TELEGRAM_OWNER_CHAT_ID, msg).catch(() => {});
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
