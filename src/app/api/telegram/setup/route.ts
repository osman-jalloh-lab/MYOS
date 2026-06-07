import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setTelegramWebhook } from "@/lib/telegram";

/**
 * POST /api/telegram/setup — registers this deployment's webhook URL with
 * Telegram. One-time (or per-redeploy-domain) admin action, session-gated
 * since this is a single-user system and there's no other natural owner check.
 *
 * Body: { "url": "https://<your-domain>/api/telegram/webhook" }
 * Telegram will echo TELEGRAM_WEBHOOK_SECRET back on every update via the
 * X-Telegram-Bot-Api-Secret-Token header, which the webhook route verifies.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "TELEGRAM_WEBHOOK_SECRET is not set" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url?.trim()) {
    return NextResponse.json({ error: "url is required, e.g. https://your-domain/api/telegram/webhook" }, { status: 400 });
  }

  try {
    const result = await setTelegramWebhook(body.url.trim(), secret);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
