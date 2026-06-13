"use client";

import { useEffect, useRef, useState } from "react";

interface MirrorMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/**
 * Live read-only mirror of the Telegram bridge. Everything Osman sends the
 * bot from his phone (and every reply the bot sends back) is persisted by
 * the webhook with channel "telegram" — this panel just reads that stream
 * back, so the dashboard always shows what happened on the phone. Polls
 * every 15s; no write path, no send box (CLAUDE.md rule 3 — Telegram talk
 * happens in Telegram, the dashboard only witnesses it).
 */
export default function TelegramMirror() {
  const [messages, setMessages] = useState<MirrorMessage[] | null>(null);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/chat?channel=telegram");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { messages: MirrorMessage[] };
        if (cancelled) return;
        setMessages(data.messages);
        setError(false);
        const newest = data.messages[data.messages.length - 1]?.id ?? null;
        if (newest && newest !== lastIdRef.current) {
          lastIdRef.current = newest;
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
          });
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();
    const t = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  function fmtWhen(iso: string) {
    const d = new Date(iso);
    const today = d.toDateString() === new Date().toDateString();
    return today
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="tg-mirror">
      <div className="tg-mirror-head">
        <span className="tg-mirror-ic">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.6c.3-1.2-.9-2.2-2-1.7L2.7 9.6c-1.2.5-1.1 2.2.1 2.6l4.4 1.4 1.7 5.3c.3 1.1 1.7 1.4 2.5.6l2.4-2.3 4.5 3.3c1 .7 2.4.2 2.6-1l3-14.9zM9.1 13.2l8.5-5.4c.4-.2.7.3.4.6l-6.7 6.4-.3 3-1.9-4.6z"/></svg>
        </span>
        <span className="tg-mirror-title">Telegram</span>
        <span className="tg-mirror-badge">
          <span className="tg-mirror-dot" />
          live mirror
        </span>
      </div>

      <div ref={scrollRef} className="tg-mirror-scroll">
        {messages === null && !error && (
          <div className="tg-mirror-empty">Connecting…</div>
        )}
        {error && (
          <div className="tg-mirror-empty">Sign in to see your Telegram stream.</div>
        )}
        {messages !== null && messages.length === 0 && !error && (
          <div className="tg-mirror-empty">
            Nothing yet. Message the bot on your phone — it shows up here.
          </div>
        )}
        {messages?.map((m) => (
          <div key={m.id} className={`tg-msg ${m.role === "user" ? "tg-msg-you" : "tg-msg-bot"}`}>
            <div className="tg-msg-meta">
              <b>{m.role === "user" ? "You · phone" : "Hermes"}</b>
              <span>{fmtWhen(m.createdAt)}</span>
            </div>
            <div className="tg-msg-body">{m.content}</div>
          </div>
        ))}
      </div>

      <div className="tg-mirror-foot">read-only · replies happen in Telegram</div>
    </div>
  );
}
