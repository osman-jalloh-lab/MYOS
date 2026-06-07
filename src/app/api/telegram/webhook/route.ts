import { prisma } from "@/lib/db";
import { sendMessage } from "@/lib/chat";
import {
  sendTelegramMessage,
  answerCallbackQuery,
  isFromOwner,
  type InlineButton,
  type TelegramUpdate,
} from "@/lib/telegram";
import type { RouteResult } from "@/agents/hermes";

// Renders each pending approval as one row of Approve/Reject buttons whose
// callback_data is literally "approve <id>" / "reject <id>" — the exact text
// routeMessage's approval-verb branch already parses, so a button tap takes
// the same code path as typing the command by hand.
function approvalButtons(route: RouteResult): InlineButton[][] | undefined {
  if (!route.pendingApprovals?.length) return undefined;
  return route.pendingApprovals.map((p) => [
    { text: `✅ Approve ${p.actionType} (${p.id.slice(0, 8)})`, callback_data: `approve ${p.id}` },
    { text: `❌ Reject`, callback_data: `reject ${p.id}` },
  ]);
}

/**
 * POST /api/telegram/webhook — receives Telegram Bot API updates.
 *
 * Single-user bridge: every update is checked against TELEGRAM_OWNER_CHAT_ID
 * before anything runs (anything else is silently ignored — not an error
 * response, since Telegram would just retry). Verified via the
 * X-Telegram-Bot-Api-Secret-Token header Telegram echoes back, matched
 * against TELEGRAM_WEBHOOK_SECRET (set via setWebhook at registration time).
 *
 * Both plain text and inline-button taps funnel into the exact same
 * sendMessage() -> Hermes.routeMessage() core the dashboard chat uses —
 * Telegram is a new *client* of the approval queue, never a new path around
 * it (CLAUDE.md rule 3). "Approve"/"Reject" buttons literally send the text
 * "approve <id>" / "reject <id>" through routeMessage, which calls the same
 * approveAction/rejectAction the /approvals page calls.
 */
export async function POST(req: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID;

  if (!expectedSecret || !ownerChatId) {
    return new Response("Telegram bridge not configured", { status: 503 });
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  if (!update) return new Response("ok"); // malformed — ack so Telegram doesn't retry forever

  if (!isFromOwner(update, ownerChatId)) {
    return new Response("ok"); // ignore anyone who isn't Osman; not an error to Telegram
  }

  // Single-user system — the owner's Telegram chat maps to the one Hermes user.
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) return new Response("ok");

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const text = cq.data?.trim();
    if (chatId && text) {
      const result = await sendMessage(user.id, text, "telegram");
      await answerCallbackQuery(cq.id, result.route.reply.slice(0, 180));
      await sendTelegramMessage(chatId, result.reply.content, approvalButtons(result.route));
    } else {
      await answerCallbackQuery(cq.id);
    }
    return new Response("ok");
  }

  const chatId = update.message?.chat.id;
  const text = update.message?.text?.trim();
  if (chatId && text) {
    const result = await sendMessage(user.id, text, "telegram");
    await sendTelegramMessage(chatId, result.reply.content, approvalButtons(result.route));
  }

  return new Response("ok");
}
