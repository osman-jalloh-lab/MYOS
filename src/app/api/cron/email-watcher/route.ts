// Vercel Cron: email-watcher — runs every 15 minutes.
// Fetches recent emails, filters for action-needed ones (recruiter, interview,
// deadline, follow-up), and sends a Telegram notification with a "Draft Reply"
// inline button. Tapping the button automatically drafts a response via the
// existing approval queue — nothing sends until you approve it.

import { prisma } from "@/lib/db";
import { fetchInboxMessages } from "@/lib/gmail";
import { sendTelegramMessage } from "@/lib/telegram";
import type { InlineButton } from "@/lib/telegram";

const OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID;
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000; // don't re-notify same email for 4 hours
const RECENCY_MS = 20 * 60 * 1000; // only alert on emails received in last 20 min

const ACTION_KEYWORDS = [
  "still interested", "are you available", "interview", "next steps",
  "offer", "deadline", "action required", "please respond", "following up",
  "follow up", "recruiter", "opportunity", "application", "schedule",
  "availability", "onsite", "on-site", "virtual", "zoom", "teams meeting",
  "background check", "start date", "onboarding", "rejection", "unfortunately",
  "move forward", "next round", "phone screen", "technical",
];

function isActionNeeded(subject: string, snippet: string, from: string): boolean {
  const text = `${subject} ${snippet} ${from}`.toLowerCase();
  return ACTION_KEYWORDS.some((kw) => text.includes(kw));
}

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!OWNER_CHAT_ID) {
    return Response.json({ ok: false, reason: "TELEGRAM_OWNER_CHAT_ID not set" });
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  const now = new Date();
  const notified: string[] = [];

  for (const user of users) {
    let emails;
    try {
      emails = await fetchInboxMessages(user.id, 20);
    } catch {
      continue;
    }

    // Filter to recent + action-needed emails only
    const actionEmails = emails.filter((m) => {
      const receivedAt = new Date(m.receivedAt);
      const isRecent = now.getTime() - receivedAt.getTime() < RECENCY_MS;
      return isRecent && isActionNeeded(m.subject, m.snippet, m.from);
    });

    for (const email of actionEmails) {
      // Dedup — skip if already notified for this email in the last 4 hours
      const alreadySent = await prisma.agentRun.findFirst({
        where: {
          agentName: "email-watcher",
          inputSummary: { contains: email.id },
          createdAt: { gte: new Date(now.getTime() - DEDUP_WINDOW_MS) },
        },
      });
      if (alreadySent) continue;

      // Clean up "from" display — show name only if available
      const fromDisplay = email.from.includes("<")
        ? email.from.split("<")[0].trim().replace(/^"|"$/g, "")
        : email.from;

      const lines = [
        `📬 *New email needs attention*`,
        `*From:* ${fromDisplay}`,
        `*Subject:* ${email.subject}`,
        `*Preview:* ${email.snippet.slice(0, 120)}${email.snippet.length > 120 ? "…" : ""}`,
      ];

      // Inline button — tapping sends "draft a reply to this email from {from} about {subject}"
      // which flows through the Telegram webhook → sendMessage() → LLM planner → email_draft intent
      const draftCommand = `draft a reply to this email from ${fromDisplay} about: ${email.subject}`;
      const buttons: InlineButton[][] = [
        [
          { text: "✏️ Draft Reply", callback_data: draftCommand.slice(0, 64) },
          { text: "✅ Mark Read", callback_data: `mark as read: ${email.subject.slice(0, 30)}` },
        ],
      ];

      try {
        await sendTelegramMessage(OWNER_CHAT_ID, lines.join("\n"), buttons);
        await prisma.agentRun.create({
          data: {
            agentName: "email-watcher",
            inputSummary: `email=${email.id} from=${email.from}`,
            outputSummary: `notified: ${email.subject.slice(0, 100)}`,
            status: "completed",
          },
        });
        notified.push(email.subject);
      } catch (err) {
        console.error(`[email-watcher] failed to notify for "${email.subject}":`, err);
      }
    }
  }

  return Response.json({ ok: true, job: "email-watcher", notified });
}
