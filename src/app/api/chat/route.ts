import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { chatHistory, sendMessage } from "@/lib/chat";

/**
 * GET /api/chat — recent chat history (dashboard chat panel hydration).
 * POST /api/chat — send a message to Hermes, get a routed reply.
 *
 * Both the dashboard chat panel and the Telegram bridge ultimately call
 * sendMessage() -> Hermes.routeMessage() -> the same approval-queue and
 * read-tool paths every other surface uses. Chat is a new *client*, never a
 * new write path (CLAUDE.md rule 3).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const messages = await chatHistory(session.user.id);
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { message?: string } | null;
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const result = await sendMessage(session.user.id, body.message.trim(), "dashboard");
  return NextResponse.json({ userMessage: result.userMessage, reply: result.reply });
}
