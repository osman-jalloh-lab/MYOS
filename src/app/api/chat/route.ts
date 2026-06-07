import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { chatHistory, sendMessage } from "@/lib/chat";

/**
 * GET  /api/chat?agent=<name>  — recent chat history for a thread
 * POST /api/chat               — send a message, get a routed reply
 *
 * Omitting `agent` (or passing none) targets the general Hermes thread,
 * routed through Hermes.routeMessage(). Passing an agent name targets that
 * agent's private thread, routed through Hermes.routeToAgent() — the agent
 * answers in its own voice from its own existing read tools. Both paths and
 * both the dashboard chat panel and the Telegram bridge ultimately funnel
 * through sendMessage() -> the same approval-queue and read-tool surfaces
 * every other client uses. Chat is a new *client*, never a new write path
 * (CLAUDE.md rule 3).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const agent = new URL(req.url).searchParams.get("agent");
  const messages = await chatHistory(session.user.id, 50, agent || null);
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { message?: string; agentName?: string } | null;
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const result = await sendMessage(session.user.id, body.message.trim(), "dashboard", body.agentName?.trim() || null);
  return NextResponse.json({ userMessage: result.userMessage, reply: result.reply });
}
