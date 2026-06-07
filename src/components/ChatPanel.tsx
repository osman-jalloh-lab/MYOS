"use client";

import { useEffect, useRef, useState } from "react";

interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  channel: "dashboard" | "telegram";
  createdAt: string;
}

/**
 * Talk to Hermes from the dashboard. Posts to /api/chat, which runs the
 * message through the same Hermes.routeMessage() core the Telegram bridge
 * uses — same approval-queue gating, same read-only data lookups. This panel
 * is a thin client; all the routing/intent logic lives server-side in one place.
 */
export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/chat")
      .then((r) => r.json())
      .then((data) => setMessages(data.messages ?? []))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setMessages((prev) => [
      ...prev,
      { id: `pending-${Date.now()}`, role: "user", content: text, channel: "dashboard", createdAt: new Date().toISOString() },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (data.userMessage && data.reply) {
        setMessages((prev) => [...prev.filter((m) => !m.id.startsWith("pending-")), data.userMessage, data.reply]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: "Couldn't reach Hermes — check your connection and try again.", channel: "dashboard", createdAt: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={wrap}>
      <div ref={scrollRef} style={scroll}>
        {!loaded ? (
          <p style={{ fontSize: 12, color: "var(--faint)" }}>Loading conversation…</p>
        ) : messages.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
            Ask Hermes about your calendar, inbox, spend, job pipeline, memory, or pending
            approvals — it pulls real data and replies. Type <code style={{ fontFamily: "var(--mono)" }}>approve &lt;id&gt;</code> or{" "}
            <code style={{ fontFamily: "var(--mono)" }}>reject &lt;id&gt;</code> to act on a queued item, same as the{" "}
            <a href="/approvals" style={{ color: "var(--hermes)" }}>/approvals</a> page.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{ ...bubbleRow, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{ ...bubble, ...(m.role === "user" ? userBubble : assistantBubble) }}>
                {m.content}
              </div>
            </div>
          ))
        )}
      </div>
      <div style={inputRow}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message Hermes…"
          style={inputBox}
          disabled={sending}
        />
        <button onClick={send} disabled={sending || !input.trim()} style={sendBtn}>
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 14, display: "flex", flexDirection: "column",
  height: 360, overflow: "hidden",
};

const scroll: React.CSSProperties = {
  flex: 1, overflowY: "auto", padding: "16px 18px",
  display: "flex", flexDirection: "column", gap: 8,
};

const bubbleRow: React.CSSProperties = { display: "flex" };

const bubble: React.CSSProperties = {
  maxWidth: "78%", padding: "9px 13px", borderRadius: 12,
  fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
};

const userBubble: React.CSSProperties = {
  background: "rgba(216,162,74,.16)", color: "var(--text)",
  borderBottomRightRadius: 3,
};

const assistantBubble: React.CSSProperties = {
  background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)",
  borderBottomLeftRadius: 3,
};

const inputRow: React.CSSProperties = {
  display: "flex", gap: 8, padding: "12px 14px",
  borderTop: "1px solid var(--line)",
};

const inputBox: React.CSSProperties = {
  flex: 1, background: "var(--bg)", border: "1px solid var(--line)",
  borderRadius: 9, padding: "9px 12px", fontSize: 12.5,
  color: "var(--text)", outline: "none",
};

const sendBtn: React.CSSProperties = {
  background: "var(--hermes)", color: "#1a1410", border: "none",
  borderRadius: 9, padding: "0 18px", fontSize: 12.5, fontWeight: 600,
  cursor: "pointer",
};
