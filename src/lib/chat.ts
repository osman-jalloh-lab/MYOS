import { prisma } from "@/lib/db";
import { routeMessage, type RouteResult } from "@/agents/hermes";

export type ChatChannel = "dashboard" | "telegram";

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  channel: ChatChannel;
  createdAt: string;
}

function toView(row: {
  id: string;
  role: string;
  content: string;
  channel: string;
  createdAt: Date;
}): ChatMessageView {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    channel: row.channel === "telegram" ? "telegram" : "dashboard",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function chatHistory(userId: string, limit = 50): Promise<ChatMessageView[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toView).reverse();
}

/**
 * Persists the user's message, runs it through Hermes.routeMessage(), persists
 * the reply, and returns both. This is the single function both the dashboard
 * chat API and the Telegram webhook call — one place where "send a message to
 * Hermes" is defined, regardless of which surface it came from.
 */
export async function sendMessage(
  userId: string,
  text: string,
  channel: ChatChannel = "dashboard"
): Promise<{ userMessage: ChatMessageView; reply: ChatMessageView; route: RouteResult }> {
  const userRow = await prisma.chatMessage.create({
    data: { userId, role: "user", content: text, channel },
  });

  const route = await routeMessage(userId, text);

  const replyRow = await prisma.chatMessage.create({
    data: { userId, role: "assistant", content: route.reply, channel },
  });

  return { userMessage: toView(userRow), reply: toView(replyRow), route };
}
