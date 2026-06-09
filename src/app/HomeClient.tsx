"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import React from "react";
import ChatPanel from "@/components/ChatPanel";
import type { ApprovalActionView } from "@/lib/approvals";
import type { TaskView } from "@/lib/tasks";
import { signInWithGoogle, signOutUser } from "./actions";

// ─── types ────────────────────────────────────────────────────────────────────

interface Props {
  userName: string;
  isAuthenticated: boolean;
  initialAgent: string | null;
  pendingApprovals: ApprovalActionView[];
  tasks: TaskView[];
  finIncome: number;
  finExpenses: number;
  finNet: number;
  finLlmSpent: number;
  finLlmCap: number;
  finLlmPct: number;
  finLlmLevel: string;
  finTotalCalls: number;
  finByCategory: { category: string; total: number }[];
  finDebtPct: number | null;
  finDebtBalance: number | null;
  finDebtPaid: number;
  accounts: { id: string; email: string; label: string | null; isDefault: boolean }[];
  memories: { id: string; fact: string; source: string | null }[];
  athena: {
    byStatus: Record<string, number>;
    recent: { id: string; title: string; company: string; status: string; fitScore: number | null }[];
  } | null;
  sophosBrief: { outputSummary: string | null; createdAt: string } | null;
}

// ─── agents ───────────────────────────────────────────────────────────────────

const AGENTS = [
  { id: "hermes",    av: "HM", name: "Hermes",    role: "Orchestrator",  color: "var(--cc-purple)",  color2: "var(--cc-purple-2)", status: "routing messages + approvals",               load: 42, warn: false },
  { id: "iris",      av: "IR", name: "Iris",       role: "Inbox",         color: "var(--cc-blue)",    color2: "var(--cc-blue-2)",   status: "scanning inboxes · classifying threads",     load: 68, warn: false },
  { id: "kairos",    av: "KA", name: "Kairos",     role: "Calendar",      color: "var(--cc-purple)",  color2: "var(--cc-purple-2)", status: "reading calendar · checking conflicts",      load: 28, warn: true  },
  { id: "argus",     av: "AG", name: "Argus",      role: "Daily Brief",   color: "var(--cc-orange)",  color2: "var(--cc-orange-2)", status: "synthesising signals for your brief",        load: 35, warn: false },
  { id: "plutus",    av: "PL", name: "Plutus",     role: "Finance",       color: "var(--cc-green)",   color2: "var(--cc-green-2)",  status: "monitoring budget · logging entries",        load: 20, warn: false },
  { id: "athena",    av: "AT", name: "Athena",     role: "Career",        color: "var(--cc-orange)",  color2: "var(--cc-orange-2)", status: "scanning job boards · scoring leads",        load: 55, warn: false },
  { id: "mnemosyne", av: "MN", name: "Mnemosyne",  role: "Memory",        color: "var(--cc-teal)",    color2: "var(--cc-teal-2)",   status: "maintaining context · surfacing facts",      load: 18, warn: false },
  { id: "sophos",    av: "SO", name: "Sophos",     role: "Skills Scout",  color: "var(--cc-cyan)",    color2: "var(--cc-cyan)",     status: "watching releases · building skill digest",  load: 12, warn: false },
];

const AGENT_META: Record<string, { displayName: string; accentColor: string; emptyText: string }> = {
  hermes:    { displayName: "Hermes",    accentColor: "var(--cc-purple)", emptyText: 'Ask Hermes anything — "draft a reply", "what\'s due today?", "log expense", "find GRC jobs".' },
  iris:      { displayName: "Iris",      accentColor: "var(--cc-blue)",   emptyText: "Ask Iris about your inbox — unread counts, what needs a reply, or draft a response." },
  kairos:    { displayName: "Kairos",    accentColor: "var(--cc-purple)", emptyText: "Ask Kairos about your week — calendar events, scheduling conflicts, or focus blocks." },
  argus:     { displayName: "Argus",     accentColor: "var(--cc-orange)", emptyText: "Ask Argus what's worth your attention today — synthesised signals and risk-flagged items." },
  plutus:    { displayName: "Plutus",    accentColor: "var(--cc-green)",  emptyText: "Ask Plutus about your money — net position, budget status, or debt tracking." },
  athena:    { displayName: "Athena",    accentColor: "var(--cc-orange)", emptyText: "Ask Athena about your job search — pipeline status, fit scores, or resume improvements." },
  mnemosyne: { displayName: "Mnemosyne", accentColor: "var(--cc-teal)",   emptyText: "Ask Mnemosyne what it remembers — approved facts relevant to what you're working on." },
  sophos:    { displayName: "Sophos",    accentColor: "var(--cc-cyan)",   emptyText: "Ask Sophos what's new — recent Anthropic releases or repos worth a look for your stack." },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function fmtHour(name: string) {
  const h = new Date().getHours();
  const g = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${g}, ${name}.`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function agentColor(type: string) {
  const m: Record<string, string> = {
    save_memory: "var(--cc-teal)", create_task: "var(--cc-purple)",
    log_expense: "var(--cc-green)", log_income: "var(--cc-green)",
    add_job: "var(--cc-orange)", apply_to_job: "var(--cc-orange)",
    draft_email: "var(--cc-blue)", send_email: "var(--cc-blue)",
    create_event: "var(--cc-purple)",
  };
  return m[type] ?? "var(--cc-purple)";
}
function agentAv(type: string) {
  const m: Record<string, string> = {
    save_memory: "MN", create_task: "HM", log_expense: "PL", log_income: "PL",
    add_job: "AT", apply_to_job: "AT", draft_email: "IR", send_email: "IR", create_event: "KA",
  };
  return m[type] ?? "HM";
}
function agentLabel(type: string) {
  const m: Record<string, string> = {
    save_memory: "Mnemosyne · Memory", create_task: "Hermes · Task",
    log_expense: "Plutus · Finance", log_income: "Plutus · Finance",
    add_job: "Athena · Career", apply_to_job: "Athena · Career",
    draft_email: "Iris · Email", send_email: "Iris · Email",
    create_event: "Kairos · Calendar",
  };
  return m[type] ?? "Hermes";
}
function kindLabel(type: string) {
  const m: Record<string, string> = {
    save_memory: "Memory", create_task: "Task", log_expense: "Expense", log_income: "Income",
    add_job: "Career · Job", apply_to_job: "Career · Apply",
    draft_email: "Email draft", send_email: "Email send", create_event: "Calendar event",
  };
  return m[type] ?? type.replace(/_/g, " ");
}
function approvalTitle(item: ApprovalActionView) {
  const p = item.payload as Record<string, unknown>;
  switch (item.actionType) {
    case "save_memory":  return `Remember: "${String(p.fact ?? "").slice(0, 80)}"`;
    case "create_task":  return `Create task: "${String(p.title ?? "").slice(0, 80)}"`;
    case "log_expense":  return `Log $${Number(p.amountUsd ?? 0).toFixed(2)} expense${p.description ? ` — ${p.description}` : ""}`;
    case "log_income":   return `Log $${Number(p.amountUsd ?? 0).toFixed(2)} income${p.description ? ` — ${p.description}` : ""}`;
    case "add_job":      return `Track job: ${p.title} at ${p.company}`;
    case "draft_email":  return `Draft email: "${String(p.subject ?? "").slice(0, 60)}"`;
    case "create_event": return `Schedule: "${String(p.title ?? "").slice(0, 60)}"`;
    default:             return item.actionType.replace(/_/g, " ");
  }
}

// ─── component ───────────────────────────────────────────────────────────────

export default function HomeClient({
  userName, isAuthenticated, initialAgent,
  pendingApprovals, tasks,
  finIncome, finExpenses, finNet, finLlmSpent, finLlmCap, finLlmPct, finLlmLevel,
  finTotalCalls, finByCategory, finDebtPct, finDebtBalance, finDebtPaid,
  accounts, memories, athena, sophosBrief,
}: Props) {
  const router = useRouter();
  const chatRef  = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [approvals, setApprovals] = useState(pendingApprovals);
  const [acting, setActing]       = useState<string | null>(null);
  const [activeFilter, setFilter] = useState("All");
  const [copied, setCopied]       = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<string | null>(initialAgent);

  const pendingCount  = approvals.length;
  const openTaskCount = tasks.length;
  const todayTasks    = tasks.filter((t) => t.dueAt && new Date(t.dueAt).toDateString() === new Date().toDateString());

  const activeAgentData = activeAgent ? AGENTS.find((a) => a.id === activeAgent) ?? null : null;
  const chatMeta        = activeAgent ? AGENT_META[activeAgent] : null;

  function copyCmd(cmd: string) {
    navigator.clipboard.writeText(cmd).catch(() => {});
    setCopied(cmd);
    setTimeout(() => setCopied(null), 2000);
  }

  function selectAgent(id: string | null) {
    setActiveAgent(id);
    window.history.replaceState({}, "", id ? `/?agent=${id}` : "/");
    setTimeout(() => {
      const canvas = canvasRef.current;
      const chat   = chatRef.current;
      if (canvas && chat) canvas.scrollTo({ top: chat.offsetTop - 80, behavior: "smooth" });
      setTimeout(() => {
        const input = document.querySelector<HTMLElement>("#chat textarea, #chat input[type=text]");
        input?.focus();
      }, 400);
    }, 50);
  }

  async function handleApproval(id: string, verb: "approve" | "reject") {
    setActing(id);
    await fetch(`/api/approvals/${id}/${verb}`, { method: "POST" });
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    setActing(null);
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="cc-shell">

        {/* ── TOP BAR ── */}
        <header className="cc-topbar">
          <div className="cc-brand">
            <div className="cc-glyph" />
            <div>
              <div className="cc-brand-name">Parawi</div>
              <div className="cc-brand-sub">Personal OS</div>
            </div>
          </div>

          <div className="cc-search">
            <div className="cc-cmdbar" onClick={() => selectAgent(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
              <span className="cc-placeholder">Ask Hermes — <b>&quot;draft a reply&quot;</b>, <b>&quot;what&apos;s due today?&quot;</b>, <b>&quot;log expense&quot;</b></span>
              <span className="cc-kbd"><span>⌘</span><span>K</span></span>
            </div>
          </div>

          <div className="cc-top-meta">
            <div className="cc-tg-chip">
              <span className="cc-dot" style={{ background: "var(--cc-success)", boxShadow: "0 0 6px var(--cc-success)" }} />
              Telegram · linked
            </div>
            {isAuthenticated ? (
              <form action={signOutUser} style={{ display: "contents" }}>
                <button type="submit" className="cc-me" title="Sign out">{userName.slice(0, 2).toUpperCase()}</button>
              </form>
            ) : (
              <form action={signInWithGoogle} style={{ display: "contents" }}>
                <button type="submit" className="cc-btn">Connect Google</button>
              </form>
            )}
          </div>
        </header>

        {/* ── LEFT RAIL ── */}
        <aside className="cc-rail">
          <div className="cc-rail-section">
            <div className="cc-rail-h">Departments</div>
            {[
              { label: "Office",  color: "var(--cc-purple)", icon: "home",  count: pendingCount > 0 ? String(pendingCount) : "—", active: !activeAgent, fn: () => { setActiveAgent(null); canvasRef.current?.scrollTo({ top: 0, behavior: "smooth" }); } },
              { label: "Inbox",   color: "var(--cc-blue)",   icon: "mail",  count: "—",                                              fn: () => selectAgent("iris") },
              { label: "Tasks",   color: "var(--cc-green)",  icon: "check", count: String(openTaskCount), urgent: openTaskCount > 10,  fn: () => selectAgent("hermes") },
              { label: "Career",  color: "var(--cc-orange)", icon: "brief", count: String(athena?.recent.length ?? "—"),               fn: () => selectAgent("athena") },
              { label: "Finance", color: "var(--cc-green)",  icon: "fin",   count: "—",                                              fn: () => selectAgent("plutus") },
              { label: "Memory",  color: "var(--cc-teal)",   icon: "mem",   count: String(memories.length || "—"),                    fn: () => selectAgent("mnemosyne") },
            ].map((d) => (
              <div key={d.label} className={`cc-dept${d.active ? " active" : ""}${d.urgent ? " has-urgent" : ""}`} style={{ "--c": d.color } as React.CSSProperties} onClick={d.fn} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && d.fn()}>
                <span className="cc-dept-ic"><DeptIcon type={d.icon} /></span>
                <span>{d.label}</span>
                <span className="cc-dept-count">{d.count}</span>
              </div>
            ))}
          </div>

          <div className="cc-rail-section">
            <div className="cc-rail-h">Agent floor · {AGENTS.length} active</div>
            <div className="cc-agents-rail">
              {AGENTS.map((a) => (
                <div key={a.id} className={`cc-agent-row cc-agent-row-btn${activeAgent === a.id ? " is-active" : ""}`} style={{ "--c": a.color } as React.CSSProperties} onClick={() => selectAgent(a.id)} role="button" tabIndex={0} title={`Chat with ${a.name}`} onKeyDown={(e) => e.key === "Enter" && selectAgent(a.id)}>
                  <span className="cc-agent-av" style={{ background: `linear-gradient(160deg, ${a.color}, color-mix(in srgb, ${a.color} 60%, black))` }}>{a.av}</span>
                  <span className="cc-agent-nm">
                    {a.name}
                    <small>{a.role.toLowerCase()}</small>
                  </span>
                  <span className={`cc-pulse${a.warn ? " warn" : ""}`} />
                </div>
              ))}
            </div>
          </div>

          <div className="cc-rail-status">
            <div className="cc-stat-row"><span>Pending approvals</span><b>{pendingCount}</b></div>
            <div className="cc-stat-row"><span>Open tasks</span><b>{openTaskCount}</b></div>
            <div className="cc-stat-row"><span>Net (month)</span><b>${finNet.toFixed(2)}</b></div>
            <div className="cc-stat-row"><span>Vault</span><b style={{ color: "var(--cc-green-2)" }}>AES-256 · on</b></div>
          </div>
        </aside>

        {/* ── CANVAS ── */}
        <main ref={canvasRef} className="cc-canvas">

          {/* HERO */}
          <section className="cc-hero">
            <div className="cc-hero-text">
              <div className="cc-eyebrow">
                <span className="cc-dot" style={{ background: "var(--cc-purple-2)", boxShadow: "0 0 8px var(--cc-purple-2)" }} />
                {fmtDate()}
              </div>
              <h1 className="cc-h1">{fmtHour(userName)}</h1>
              <p className="cc-sum">
                The office is open.
                {pendingCount > 0 && <> <b className="cc-urg">{pendingCount} item{pendingCount !== 1 ? "s" : ""} awaiting approval</b>,</>}
                {" "}<b>{openTaskCount} open task{openTaskCount !== 1 ? "s" : ""}</b>
                {todayTasks.length > 0 && <> ({todayTasks.length} due today)</>}.
                {" "}All {AGENTS.length} agents are on shift.
              </p>
              <div className="cc-brief-actions">
                <button className="cc-btn cc-btn-primary" onClick={() => router.push("/approvals")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l4 4L19 6"/></svg>
                  Review approvals
                </button>
                <button className="cc-btn" onClick={() => selectAgent(null)}>Open chat</button>
              </div>
            </div>

            <div className="cc-office-card">
              <Image className="cc-pixelated" src="/office-scene.png" alt="Hermes OS agent office" fill sizes="(max-width: 768px) 100vw, 480px" priority />
              <div className="cc-scrim" />
              <div className="cc-corner">
                <span className="cc-blink" />
                {AGENTS.length} of {AGENTS.length} agents on shift
              </div>
              <div className="cc-bubbles">
                <span className="cc-bubble" style={{ "--c": "var(--cc-blue-2)" } as React.CSSProperties}><span className="cc-dot" />Iris · scanning</span>
                <span className="cc-bubble" style={{ "--c": "var(--cc-orange-2)" } as React.CSSProperties}><span className="cc-dot" />Athena · matching</span>
                <span className="cc-bubble" style={{ "--c": "var(--cc-teal-2)" } as React.CSSProperties}><span className="cc-dot" />Mnemosyne · indexing</span>
                <span className="cc-bubble" style={{ "--c": "var(--cc-purple-2)" } as React.CSSProperties}><span className="cc-dot" />Kairos · watching</span>
              </div>
            </div>
          </section>

          {/* DEPT STRIP */}
          <section className="cc-dept-strip">
            <DeptTile color="var(--cc-purple)" label="Approvals" n={pendingCount}  sub="awaiting sign-off"                                             onClick={() => router.push("/approvals")} />
            <DeptTile color="var(--cc-green)"  label="Tasks"     n={openTaskCount} sub={`${todayTasks.length} due today`}                              onClick={() => selectAgent("hermes")} />
            <DeptTile color="var(--cc-green)"  label="Income"    n={0}             sub={`$${finIncome.toFixed(2)} this month`}                         onClick={() => selectAgent("plutus")} />
            <DeptTile color="var(--cc-orange)" label="Expenses"  n={0}             sub={`$${finExpenses.toFixed(2)} this month`}                       onClick={() => selectAgent("plutus")} />
            <DeptTile color="var(--cc-blue)"   label="Agents"    n={AGENTS.length} sub="all on shift" onClick={() => { const el = document.getElementById("agent-floor"); const canvas = canvasRef.current; if (el && canvas) canvas.scrollTo({ top: el.offsetTop - 80, behavior: "smooth" }); }} />
            <DeptTile color="var(--cc-cyan)"   label="Skills"    n={0}             sub="Sophos checks Monday"                                          onClick={() => selectAgent("sophos")} muted />
            <DeptTile color="var(--cc-orange)" label="Career"    n={athena?.recent.length ?? 0} sub={`${(athena?.byStatus.applied ?? 0) + (athena?.byStatus.interview ?? 0)} in progress`} onClick={() => selectAgent("athena")} muted />
          </section>

          {/* CHAT PANEL */}
          <section ref={chatRef} className="cc-card" id="chat">
            <header className="cc-card-h">
              {activeAgentData ? (
                <>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(160deg, ${activeAgentData.color}, color-mix(in srgb, ${activeAgentData.color} 60%, black))`, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                    {activeAgentData.av}
                  </div>
                  <h3 style={{ margin: 0 }}>
                    {activeAgentData.name}
                    <span style={{ fontWeight: 400, color: "var(--cc-fg-muted)", marginLeft: 8, fontSize: 12 }}>· {activeAgentData.role.toLowerCase()}</span>
                    <span className="cc-badge" style={{ marginLeft: 10 }}>
                      <span className="cc-dot" style={{ background: activeAgentData.color, boxShadow: `0 0 6px ${activeAgentData.color}` }} />
                      private thread
                    </span>
                  </h3>
                  <button className="cc-filter" style={{ marginLeft: "auto" }} onClick={() => selectAgent(null)}>← All agents</button>
                </>
              ) : (
                <>
                  <h3 style={{ margin: 0 }}>
                    Talk to Hermes
                    <span className="cc-badge" style={{ marginLeft: 10 }}>
                      <span className="cc-dot" style={{ background: "var(--cc-success)", boxShadow: "0 0 6px var(--cc-success)" }} />
                      live
                    </span>
                  </h3>
                  <div className="cc-card-right" style={{ color: "var(--cc-fg-faint)", fontSize: 12 }}>
                    {isAuthenticated ? "routes to agents · gates writes through approvals" : "sign in to start"}
                  </div>
                </>
              )}
            </header>
            {isAuthenticated ? (
              <ChatPanel
                key={activeAgent ?? "hermes"}
                agentName={activeAgent && activeAgent !== "hermes" ? activeAgent : undefined}
                displayName={chatMeta?.displayName ?? "Hermes"}
                accentColor={chatMeta?.accentColor ?? "var(--cc-purple)"}
                height={420}
              />
            ) : (
              <div style={{ padding: "40px 20px", textAlign: "center" }}>
                <p style={{ color: "var(--cc-fg-muted)", fontSize: 13, marginBottom: 16 }}>Sign in with Google to talk to Hermes.</p>
                <form action={signInWithGoogle}>
                  <button type="submit" className="cc-btn cc-btn-primary">Connect Google</button>
                </form>
              </div>
            )}
          </section>

          {/* FEED + APPROVALS */}
          <section className="cc-main-grid">
            <article className="cc-card">
              <header className="cc-card-h">
                <h3>
                  On the floor today
                  <span className="cc-badge">
                    <span className="cc-dot" style={{ background: "var(--cc-purple-2)", boxShadow: "0 0 6px var(--cc-purple-2)" }} />
                    live
                  </span>
                </h3>
                <div className="cc-card-right">
                  {["All", "Tasks", "Finance", "Career", "Memory"].map((f) => (
                    <button key={f} className={`cc-filter${activeFilter === f ? " on" : ""}`} onClick={() => setFilter(f)}>{f}</button>
                  ))}
                </div>
              </header>
              <div className="cc-feed">
                <FeedItem color="var(--cc-orange)" av="AG" tag="Argus · Brief"    head="Daily brief ready"     body="Ask &quot;open brief&quot; in chat to read today&apos;s synthesised signals." onClick={() => selectAgent("argus")} />
                <FeedItem color="var(--cc-blue)"   av="IR" tag="Iris · Inbox"     head="Inbox agent ready"     body="Ask Iris to &quot;triage my inbox&quot; or &quot;summarise unread emails&quot;." onClick={() => selectAgent("iris")} />
                <FeedItem color="var(--cc-orange)" av="AT" tag="Athena · Career"  head="Job pipeline ready"    body="Ask &quot;find GRC jobs in Austin&quot; or &quot;score this listing&quot;. Matches go through approvals." onClick={() => selectAgent("athena")} />
                {(activeFilter === "All" || activeFilter === "Tasks") && tasks.slice(0, 4).map((t) => (
                  <FeedItem key={t.id} color="var(--cc-green)" av="HM" tag="Tasks" head={t.title} body={`Priority: ${t.priority}${t.dueAt ? ` · Due ${new Date(t.dueAt).toLocaleDateString()}` : ""}${t.assignedAgent ? ` · ${t.assignedAgent}` : ""}`} />
                ))}
                {(activeFilter === "All" || activeFilter === "Finance") && (finIncome > 0 || finExpenses > 0) && (
                  <FeedItem color="var(--cc-green)" av="PL" tag="Plutus · Finance" head={`Month: $${finIncome.toFixed(2)} in / $${finExpenses.toFixed(2)} out`} body={`Net: $${finNet.toFixed(2)}`} />
                )}
                {(activeFilter === "All" || activeFilter === "Memory") && memories.slice(0, 3).map((m) => (
                  <FeedItem key={m.id} color="var(--cc-teal)" av="MN" tag="Mnemosyne · Memory" head={m.fact.slice(0, 80)} body={m.source ? `source: ${m.source}` : "approved memory"} />
                ))}
              </div>
            </article>

            <article className="cc-card">
              <header className="cc-card-h">
                <h3>
                  Awaiting your approval
                  <span className="cc-badge">
                    <span className="cc-dot" style={{ background: pendingCount > 0 ? "var(--cc-orange-2)" : "var(--cc-success)", boxShadow: `0 0 6px ${pendingCount > 0 ? "var(--cc-orange-2)" : "var(--cc-success)"}` }} />
                    {pendingCount} item{pendingCount !== 1 ? "s" : ""}
                  </span>
                </h3>
                <div className="cc-card-right" style={{ color: "var(--cc-fg-faint)", fontSize: 12 }}>Nothing writes without you.</div>
              </header>
              <div className="cc-approve">
                {approvals.length === 0 && (
                  <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--cc-fg-muted)", fontSize: 13 }}>All clear — no pending approvals.</div>
                )}
                {approvals.map((item) => {
                  const c = agentColor(item.actionType);
                  return (
                    <div key={item.id} className="cc-appr">
                      <div className="cc-appr-top">
                        <div className="cc-appr-agent" style={{ "--c": c } as React.CSSProperties}>
                          <span className="cc-appr-av" style={{ background: `linear-gradient(160deg, ${c}, color-mix(in srgb, ${c} 60%, black))` }}>{agentAv(item.actionType)}</span>
                          <span>by <b>{agentLabel(item.actionType)}</b></span>
                        </div>
                        <span className="cc-kind" style={{ "--c": c } as React.CSSProperties}>{kindLabel(item.actionType)}</span>
                      </div>
                      <div className="cc-appr-title">{approvalTitle(item)}</div>
                      <div className="cc-appr-meta">
                        <span>{fmtTime(item.createdAt)}</span>
                        <span>ID: {item.id.slice(0, 8)}</span>
                      </div>
                      <div className="cc-appr-actions">
                        <button className="cc-btn-s cc-go" disabled={acting === item.id} onClick={() => handleApproval(item.id, "approve")}>{acting === item.id ? "…" : "Approve"}</button>
                        <button className="cc-btn-s cc-no" disabled={acting === item.id} onClick={() => handleApproval(item.id, "reject")}>Reject</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>

          {/* AGENT OFFICE FLOOR */}
          <section id="agent-floor" className="cc-card">
            <header className="cc-card-h">
              <h3>
                Agent office
                <span className="cc-badge">
                  <span className="cc-dot" style={{ background: "var(--cc-success)", boxShadow: "0 0 6px var(--cc-success)" }} />
                  {AGENTS.length} on shift
                </span>
              </h3>
              <div className="cc-card-right">
                <span className="cc-live"><span className="cc-live-dot" />Live status</span>
              </div>
            </header>
            <div className="cc-agent-floor">
              {AGENTS.map((a) => (
                <div key={a.id} className="cc-agent-cell" style={{ "--c": a.color, cursor: "pointer" } as React.CSSProperties} onClick={() => selectAgent(a.id)} title={`Chat with ${a.name}`}>
                  <span className={`cc-pulse${a.warn ? " warn" : ""}`} style={a.warn ? { background: "var(--cc-orange-2)", boxShadow: "0 0 8px var(--cc-orange-2)" } : undefined} />
                  <div className="cc-cell-top">
                    <div className="cc-cell-av" style={{ background: `linear-gradient(160deg, ${a.color}, color-mix(in srgb, ${a.color} 60%, black))` }}>{a.av}</div>
                    <div>
                      <div className="cc-cell-nm">{a.name}</div>
                      <div className="cc-cell-rl">{a.role}</div>
                    </div>
                  </div>
                  <div className="cc-cell-status">{a.status}</div>
                  <div className="cc-cell-meter">
                    <span>load</span>
                    <div className="cc-meter-bar"><i style={{ width: `${a.load}%`, background: a.color2 }} /></div>
                    <span>Groq</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* PLUTUS — FINANCE */}
          <section className="cc-card">
            <header className="cc-card-h">
              <h3>
                Finance · Plutus
                <span className="cc-badge">
                  <span className="cc-dot" style={{ background: "var(--cc-green-2)", boxShadow: "0 0 6px var(--cc-green-2)" }} />
                  this month
                </span>
              </h3>
              <div className="cc-card-right" style={{ color: "var(--cc-fg-faint)", fontSize: 12 }}>read-only · never moves money</div>
            </header>
            <div className="cc-stat-grid">
              <div className="cc-stat-mini">
                <div className="cc-stat-mini-label">Net this month</div>
                <div className="cc-stat-mini-val" style={{ color: finNet >= 0 ? "var(--cc-green-2)" : "var(--cc-orange-2)" }}>
                  {finNet >= 0 ? "+" : "-"}${Math.abs(finNet).toFixed(2)}
                </div>
                <div className="cc-stat-mini-sub">in ${finIncome.toFixed(2)} · out ${finExpenses.toFixed(2)}</div>
              </div>
              <div className="cc-stat-mini">
                <div className="cc-stat-mini-label">LLM spend vs. cap</div>
                <div className="cc-stat-mini-val" style={{ color: finLlmLevel === "over" || finLlmLevel === "warning" ? "var(--cc-orange-2)" : "var(--cc-green-2)" }}>
                  ${finLlmSpent.toFixed(4)}
                  <span style={{ fontSize: 12, color: "var(--cc-fg-faint)", fontWeight: 400, marginLeft: 6 }}>/ ${finLlmCap.toFixed(2)}</span>
                </div>
                <div className="cc-stat-mini-sub">{finLlmPct.toFixed(1)}% used · {finLlmLevel}</div>
              </div>
              <div className="cc-stat-mini">
                <div className="cc-stat-mini-label">Model calls</div>
                <div className="cc-stat-mini-val">{finTotalCalls}</div>
                <div className="cc-stat-mini-sub">Groq · via model router</div>
              </div>
              <div className="cc-stat-mini">
                <div className="cc-stat-mini-label">Debt payoff</div>
                <div className="cc-stat-mini-val">{finDebtPct !== null ? `${finDebtPct.toFixed(1)}%` : "—"}</div>
                <div className="cc-stat-mini-sub">
                  {finDebtBalance !== null ? `balance $${finDebtBalance.toFixed(2)} · paid $${finDebtPaid.toFixed(2)}` : "no debt entries yet"}
                </div>
              </div>
            </div>
            {finByCategory.length > 0 ? (
              <div style={{ borderTop: "1px solid var(--cc-border-sub)", padding: "14px 0 0" }}>
                <div style={{ fontFamily: "var(--cc-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--cc-fg-faint)", marginBottom: 10, padding: "0 18px" }}>By category</div>
                {finByCategory.slice(0, 5).map((c) => (
                  <div key={c.category} className="cc-row-item">
                    <span className="cc-row-main">{c.category}</span>
                    <span className="cc-row-muted">${c.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ) : finIncome === 0 && finExpenses === 0 ? (
              <div className="cc-empty">No finance entries this month. Log expenses via Telegram or chat.</div>
            ) : null}
          </section>

          {/* ATHENA — CAREER */}
          {athena && (
            <section className="cc-card">
              <header className="cc-card-h">
                <h3>
                  Career · Athena
                  <span className="cc-badge">
                    <span className="cc-dot" style={{ background: "var(--cc-orange-2)", boxShadow: "0 0 6px var(--cc-orange-2)" }} />
                    pipeline
                  </span>
                </h3>
                <div className="cc-card-right" style={{ color: "var(--cc-fg-faint)", fontSize: 12 }}>drafts only · never applies</div>
              </header>
              <div className="cc-stat-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                {(["interested", "applied", "interview", "offer", "rejected"] as const).map((key) => (
                  <div key={key} className="cc-stat-mini">
                    <div className="cc-stat-mini-label">{key}</div>
                    <div className="cc-stat-mini-val">{athena.byStatus[key] ?? 0}</div>
                  </div>
                ))}
              </div>
              {athena.recent.length > 0 ? (
                <div style={{ borderTop: "1px solid var(--cc-border-sub)", padding: "14px 0 0" }}>
                  <div style={{ fontFamily: "var(--cc-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--cc-fg-faint)", marginBottom: 10, padding: "0 18px" }}>Recent roles</div>
                  {athena.recent.map((j) => (
                    <div key={j.id} className="cc-row-item">
                      <span className="cc-row-main">
                        {j.title}<span style={{ color: "var(--cc-fg-faint)", fontWeight: 400 }}> · {j.company}</span>
                      </span>
                      {j.fitScore !== null && <span style={{ fontFamily: "var(--cc-mono)", fontSize: 10.5, color: "var(--cc-orange-2)", flexShrink: 0 }}>fit {j.fitScore}</span>}
                      <span className="cc-chip" style={{ background: "rgba(245,158,11,.13)", color: "var(--cc-orange-2)", border: "1px solid rgba(245,158,11,.25)" }}>{j.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cc-empty">No roles tracked yet. Ask Athena to find jobs or log a role via chat.</div>
              )}
            </section>
          )}

          {/* MEMORY + SOPHOS + ACCOUNTS */}
          <section className="cc-three-grid">
            <article className="cc-card">
              <header className="cc-card-h">
                <h3>
                  Memory · Mnemosyne
                  <span className="cc-badge" style={{ marginLeft: 8 }}>
                    <span className="cc-dot" style={{ background: "var(--cc-teal-2)", boxShadow: "0 0 6px var(--cc-teal-2)" }} />
                    {memories.length}
                  </span>
                </h3>
              </header>
              {memories.length > 0
                ? memories.slice(0, 6).map((m) => (
                    <div key={m.id} className="cc-row-item">
                      <span className="cc-row-main">{m.fact}</span>
                      {m.source && <span className="cc-row-muted">{m.source}</span>}
                    </div>
                  ))
                : <div className="cc-empty">No approved memories yet. Mnemosyne suggests via the approval queue.</div>
              }
            </article>

            <article className="cc-card">
              <header className="cc-card-h">
                <h3>
                  Skills · Sophos
                  <span className="cc-badge" style={{ marginLeft: 8 }}>
                    <span className="cc-dot" style={{ background: "var(--cc-cyan)", boxShadow: "0 0 6px var(--cc-cyan)" }} />
                    weekly
                  </span>
                </h3>
              </header>
              {sophosBrief ? (
                <div style={{ padding: "14px 18px 18px" }}>
                  <div style={{ fontFamily: "var(--cc-mono)", fontSize: 10, color: "var(--cc-fg-faint)", marginBottom: 10 }}>
                    {new Date(sophosBrief.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--cc-fg-secondary)", margin: 0 }}>{sophosBrief.outputSummary}</p>
                </div>
              ) : (
                <div className="cc-empty">No skill brief yet. Sophos runs weekly: release notes, repo scout, video digest.</div>
              )}
            </article>

            <article className="cc-card">
              <header className="cc-card-h">
                <h3>
                  Accounts
                  <span className="cc-badge" style={{ marginLeft: 8 }}>
                    <span className="cc-dot" style={{ background: "var(--cc-blue-2)", boxShadow: "0 0 6px var(--cc-blue-2)" }} />
                    {accounts.length} linked
                  </span>
                </h3>
              </header>
              {accounts.length > 0 ? (
                <>
                  {accounts.map((acc) => (
                    <div key={acc.id} className="cc-row-item">
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(59,130,246,.16)", color: "var(--cc-blue-2)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>G</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.email}</div>
                        <div style={{ fontSize: 10, color: "var(--cc-fg-faint)", fontFamily: "var(--cc-mono)" }}>{acc.label}{acc.isDefault ? " · default" : ""}</div>
                      </div>
                      <span className="cc-chip" style={{ background: "rgba(16,185,129,.12)", color: "var(--cc-green-2)", border: "1px solid rgba(16,185,129,.25)" }}>active</span>
                    </div>
                  ))}
                  {accounts.length < 3 && (
                    <div style={{ padding: "12px 18px", display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--cc-border-sub)" }}>
                      {(["Work", "UT", "Personal"] as const).filter((l) => !accounts.some((a) => a.label === l)).map((label) => (
                        <a key={label} href={`/api/accounts/link?label=${label}`} className="cc-link-btn">+ {label}</a>
                      ))}
                    </div>
                  )}
                </>
              ) : isAuthenticated ? (
                <div className="cc-empty">No accounts linked. Connect a Google account to start.</div>
              ) : (
                <div style={{ padding: "20px 18px" }}>
                  <form action={signInWithGoogle}>
                    <button type="submit" className="cc-btn cc-btn-primary" style={{ width: "100%" }}>Connect Google</button>
                  </form>
                </div>
              )}
            </article>
          </section>

          {/* QUICK ACTIONS */}
          <section className="cc-card" style={{ position: "relative" }}>
            <header className="cc-card-h"><h3>Quick actions</h3></header>
            {copied && <div className="cc-toast">Copied: <b>{copied}</b></div>}
            <div style={{ padding: "18px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              {[
                { label: "Open chat",             action: () => selectAgent(null),                       color: "var(--cc-purple)" },
                { label: "Review approval queue", action: () => router.push("/approvals"),               color: "var(--cc-orange)" },
                { label: "Telegram: log expense", action: () => copyCmd("log expense $10 coffee"),       color: "var(--cc-green)",  note: "tap to copy — send in Telegram" },
                { label: "Telegram: add task",    action: () => copyCmd("task: my task title"),          color: "var(--cc-blue)",   note: "tap to copy — send in Telegram" },
                { label: "Telegram: remember",    action: () => copyCmd("remember my fact here"),        color: "var(--cc-teal)",   note: "tap to copy — send in Telegram" },
                { label: "Telegram: add job",     action: () => copyCmd("add job at Acme as SWE"),       color: "var(--cc-orange)", note: "tap to copy — send in Telegram" },
              ].map((q) => (
                <button key={q.label} className="cc-quick-action" style={{ "--c": q.color } as React.CSSProperties} onClick={q.action}>
                  <span className="cc-qa-dot" />
                  <span>
                    {q.label}
                    {q.note && <small>{q.note}</small>}
                  </span>
                </button>
              ))}
            </div>
          </section>

        </main>

        {/* ── MOBILE NAV ── */}
        <nav className="cc-mobile-nav">
          <button className="cc-nav-btn active" onClick={() => canvasRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></svg>
            <span>Home</span>
          </button>
          <button className="cc-nav-btn" onClick={() => selectAgent(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Chat</span>
          </button>
          <button className="cc-nav-btn" onClick={() => router.push("/approvals")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3 8-8"/><rect x="3" y="5" width="18" height="14" rx="2"/></svg>
            <span>Approve{pendingCount > 0 ? ` (${pendingCount})` : ""}</span>
          </button>
        </nav>

      </div>
    </>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────

function DeptTile({ color, label, n, sub, muted, onClick }: { color: string; label: string; n: number; sub: string; muted?: boolean; onClick?: () => void }) {
  return (
    <div
      className={`cc-dtile${!muted ? " cc-dtile-color" : " cc-dtile-muted"}${onClick ? " cc-dtile-btn" : ""}`}
      style={{ "--c": color } as React.CSSProperties}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <div>
        <div className="cc-dtile-lab">{label}</div>
        <div className="cc-dtile-n">{n}</div>
      </div>
      <div className="cc-dtile-sub">{sub}</div>
    </div>
  );
}

function FeedItem({ color, av, tag, head, body, onClick }: { color: string; av: string; tag: string; head: string; body: string; onClick?: () => void }) {
  return (
    <div className={`cc-feed-item${onClick ? " cc-feed-item-btn" : ""}`} style={{ "--c": color } as React.CSSProperties} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}>
      <span className="cc-feed-stripe" />
      <div className="cc-feed-av">{av}</div>
      <div className="cc-feed-body">
        <div className="cc-feed-top"><span className="cc-feed-tag">{tag}</span></div>
        <div className="cc-feed-head">{head}</div>
        <div className="cc-feed-desc" dangerouslySetInnerHTML={{ __html: body }} />
      </div>
    </div>
  );
}

function DeptIcon({ type }: { type: string }) {
  const p = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  switch (type) {
    case "home":  return <svg {...p}><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></svg>;
    case "mail":  return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/></svg>;
    case "check": return <svg {...p}><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>;
    case "brief": return <svg {...p}><path d="M3 7h18v13H3z"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
    case "fin":   return <svg {...p}><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
    case "mem":   return <svg {...p}><path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5a8 8 0 0 0 12 0v-5"/></svg>;
    default:      return <svg {...p}><circle cx="12" cy="12" r="8"/></svg>;
  }
}

// ─── styles ───────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --cc-bg-page:      #0E1424;
  --cc-bg-rail:      #131B2E;
  --cc-bg-surface:   #1A2336;
  --cc-bg-surface-2: #222C42;
  --cc-bg-surface-3: #2B3650;
  --cc-border:       #28324A;
  --cc-border-sub:   #1F2840;
  --cc-border-str:   #364266;
  --cc-fg-primary:   #F1F4FB;
  --cc-fg-secondary: #B7C0D6;
  --cc-fg-muted:     #8693B0;
  --cc-fg-faint:     #5A6582;
  --cc-blue:    #3B82F6; --cc-blue-2:   #60A5FA;
  --cc-purple:  #8B5CF6; --cc-purple-2: #A78BFA;
  --cc-green:   #10B981; --cc-green-2:  #34D399;
  --cc-orange:  #F59E0B; --cc-orange-2: #FBBF24;
  --cc-teal:    #14B8A6; --cc-teal-2:   #2DD4BF;
  --cc-cyan:    #38BDF8;
  --cc-success: #22C55E;
  --cc-sans: "Inter", system-ui, sans-serif;
  --cc-mono: "JetBrains Mono", ui-monospace, monospace;
}
*, *::before, *::after { box-sizing: border-box; }

.cc-shell {
  display: grid;
  grid-template-columns: 248px 1fr;
  grid-template-rows: 64px 1fr;
  height: 100dvh;
  background: var(--cc-bg-page);
  color: var(--cc-fg-primary);
  font-family: var(--cc-sans);
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

/* TOP BAR */
.cc-topbar {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 248px 1fr auto;
  align-items: center;
  border-bottom: 1px solid var(--cc-border);
  background: linear-gradient(180deg, #131B2E, #0E1424);
  position: sticky; top: 0; z-index: 20;
}
.cc-brand { display: flex; align-items: center; gap: 12px; padding: 0 24px; border-right: 1px solid var(--cc-border); height: 100%; }
.cc-glyph { width: 28px; height: 28px; background: linear-gradient(135deg, var(--cc-purple), var(--cc-blue)); border-radius: 6px; box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 4px 12px rgba(139,92,246,.35); flex-shrink: 0; }
.cc-brand-name { font: 700 17px/1 var(--cc-sans); letter-spacing: -0.01em; }
.cc-brand-sub  { font: 500 11px/1 var(--cc-sans); color: var(--cc-fg-faint); letter-spacing: 0.12em; text-transform: uppercase; margin-top: 4px; }
.cc-search { padding: 0 24px; display: flex; align-items: center; }
.cc-cmdbar { display: flex; align-items: center; gap: 12px; background: var(--cc-bg-surface); border: 1px solid var(--cc-border); border-radius: 10px; padding: 8px 14px; width: 100%; max-width: 640px; color: var(--cc-fg-muted); font: 400 13px/1 var(--cc-sans); cursor: pointer; }
.cc-cmdbar:hover { border-color: var(--cc-border-str); }
.cc-placeholder { flex: 1; }
.cc-placeholder b { color: var(--cc-fg-secondary); font-weight: 500; }
.cc-kbd { margin-left: auto; display: flex; gap: 4px; }
.cc-kbd span { padding: 3px 6px; border-radius: 4px; background: var(--cc-bg-surface-3); color: var(--cc-fg-muted); font: 500 11px/1 var(--cc-mono); border: 1px solid var(--cc-border); }
.cc-top-meta { display: flex; align-items: center; gap: 12px; padding: 0 24px; }
.cc-tg-chip { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--cc-bg-surface); border: 1px solid var(--cc-border); border-radius: 999px; font: 500 13px/1 var(--cc-sans); color: var(--cc-fg-secondary); }
.cc-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.cc-me { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(160deg, var(--cc-purple), var(--cc-blue)); display: grid; place-items: center; font: 700 13px/1 var(--cc-sans); color: #fff; border: 1px solid rgba(255,255,255,.12); flex-shrink: 0; cursor: pointer; }

/* RAIL */
.cc-rail { border-right: 1px solid var(--cc-border); background: var(--cc-bg-rail); padding: 20px 14px; overflow-y: auto; display: flex; flex-direction: column; }
.cc-rail-section { margin-bottom: 24px; }
.cc-rail-h { font: 600 11px/1 var(--cc-sans); letter-spacing: 0.14em; text-transform: uppercase; color: var(--cc-fg-faint); padding: 0 10px 10px; }
.cc-dept { display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; font: 500 13px/1 var(--cc-sans); color: var(--cc-fg-secondary); cursor: pointer; margin-bottom: 2px; position: relative; }
.cc-dept-ic { width: 28px; height: 28px; border-radius: 7px; background: var(--cc-bg-surface); border: 1px solid var(--cc-border); display: grid; place-items: center; color: var(--c, var(--cc-fg-muted)); }
.cc-dept-count { font: 500 11px/1 var(--cc-mono); padding: 3px 7px; border-radius: 999px; background: var(--cc-bg-surface); color: var(--cc-fg-muted); border: 1px solid var(--cc-border-sub); }
.cc-dept.has-urgent .cc-dept-count { background: rgba(239,68,68,.16); color: #fda4a4; border-color: rgba(239,68,68,.35); }
.cc-dept.active { background: var(--cc-bg-surface); color: var(--cc-fg-primary); border: 1px solid var(--cc-border); }
.cc-dept.active::before { content: ""; position: absolute; left: -14px; top: 50%; transform: translateY(-50%); width: 3px; height: 20px; border-radius: 0 3px 3px 0; background: var(--c, var(--cc-purple)); }
.cc-dept:hover { background: var(--cc-bg-surface-2); color: var(--cc-fg-primary); }
.cc-agents-rail { display: flex; flex-direction: column; gap: 2px; }
.cc-agent-row { display: grid; grid-template-columns: 28px 1fr 10px; gap: 10px; padding: 7px 10px; border-radius: 8px; font: 500 12px/1 var(--cc-sans); color: var(--cc-fg-secondary); align-items: center; }
.cc-agent-row-btn:hover { background: var(--cc-bg-surface); cursor: pointer; }
.cc-agent-row-btn:hover .cc-agent-nm { color: var(--cc-fg-primary); }
.cc-agent-row.is-active { background: var(--cc-bg-surface-2); }
.cc-agent-row.is-active .cc-agent-nm { color: var(--cc-fg-primary); }
.cc-agent-av { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font: 700 10px/1 var(--cc-sans); color: #fff; flex-shrink: 0; }
.cc-agent-nm { line-height: 1.3; }
.cc-agent-nm small { display: block; font: 500 10px/1.2 var(--cc-sans); color: var(--cc-fg-faint); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px; }
.cc-pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--cc-success); box-shadow: 0 0 8px var(--cc-success); animation: bk 1.2s infinite; flex-shrink: 0; }
.cc-pulse.warn { background: var(--cc-orange-2); box-shadow: 0 0 8px var(--cc-orange-2); animation-duration: 0.8s; }
@keyframes bk { 50% { opacity: 0.25; } }
.cc-rail-status { margin-top: auto; padding: 14px; background: var(--cc-bg-surface); border: 1px solid var(--cc-border); border-radius: 10px; font-size: 12px; color: var(--cc-fg-muted); }
.cc-stat-row { display: flex; justify-content: space-between; padding: 3px 0; }
.cc-stat-row b { color: var(--cc-fg-secondary); font-weight: 600; }

/* CANVAS */
.cc-canvas {
  overflow-y: auto;
  padding: 24px 28px 80px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  background: radial-gradient(1200px 600px at -10% -20%, rgba(139,92,246,.06), transparent 60%),
              radial-gradient(900px 500px at 110% 10%, rgba(59,130,246,.05), transparent 60%),
              var(--cc-bg-page);
}

/* HERO */
.cc-hero { display: grid; grid-template-columns: 1fr 480px; gap: 24px; }
.cc-hero-text { padding: 4px 0; }
.cc-eyebrow { font: 600 11px/1 var(--cc-sans); letter-spacing: 0.16em; text-transform: uppercase; color: var(--cc-fg-muted); display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.cc-h1 { font: 600 32px/1.1 var(--cc-sans); letter-spacing: -0.02em; margin: 0 0 12px; }
.cc-sum { font: 400 16px/1.5 var(--cc-sans); color: var(--cc-fg-secondary); max-width: 600px; margin: 0 0 20px; }
.cc-sum b { color: var(--cc-fg-primary); font-weight: 600; }
.cc-urg { color: #fca5a5 !important; }
.cc-brief-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.cc-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 9px; font: 600 13px/1 var(--cc-sans); border: 1px solid var(--cc-border); background: var(--cc-bg-surface); color: var(--cc-fg-primary); cursor: pointer; }
.cc-btn:hover { border-color: var(--cc-border-str); }
.cc-btn-primary { background: linear-gradient(180deg, #6F4FE0, #5B2EC8); border-color: rgba(139,92,246,.5); box-shadow: 0 6px 16px rgba(139,92,246,.25); }
.cc-office-card { position: relative; background: var(--cc-bg-surface); border: 1px solid var(--cc-border); border-radius: 16px; overflow: hidden; min-height: 240px; }
.cc-pixelated { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; image-rendering: crisp-edges; }
.cc-scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(14,20,36,0) 50%, rgba(14,20,36,.7) 100%), linear-gradient(90deg, rgba(14,20,36,.55) 0%, rgba(14,20,36,0) 35%); }
.cc-corner { position: absolute; top: 14px; left: 14px; display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(14,20,36,.6); border: 1px solid rgba(255,255,255,.08); border-radius: 999px; font: 400 11px/1 var(--cc-sans); color: var(--cc-fg-primary); backdrop-filter: blur(6px); }
.cc-blink { width: 7px; height: 7px; border-radius: 50%; background: var(--cc-success); box-shadow: 0 0 8px var(--cc-success); display: inline-block; animation: bk 1.2s infinite; flex-shrink: 0; }
.cc-bubbles { position: absolute; right: 14px; bottom: 14px; left: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
.cc-bubble { display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: rgba(14,20,36,.78); border: 1px solid rgba(255,255,255,.08); border-radius: 999px; font: 400 12px/1 var(--cc-sans); color: var(--cc-fg-primary); }
.cc-bubble .cc-dot { background: var(--c, var(--cc-purple-2)); box-shadow: 0 0 6px var(--c, var(--cc-purple-2)); }

/* DEPT STRIP */
.cc-dept-strip { display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 4px; }
.cc-dtile { background: var(--cc-bg-surface); border: 1px solid var(--cc-border); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; justify-content: space-between; min-height: 100px; min-width: 110px; }
.cc-dtile-color { background: linear-gradient(160deg, var(--c, var(--cc-blue)) 0%, color-mix(in oklab, var(--c, var(--cc-blue)) 55%, #0E1424) 100%); border-color: transparent; box-shadow: 0 8px 24px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.1); }
.cc-dtile-muted { color: var(--cc-fg-secondary); }
.cc-dtile-lab { font: 600 10px/1 var(--cc-sans); letter-spacing: 0.16em; text-transform: uppercase; opacity: .85; }
.cc-dtile-n { font: 700 28px/1 var(--cc-sans); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin-top: 4px; }
.cc-dtile-muted .cc-dtile-lab { color: var(--cc-fg-muted); }
.cc-dtile-muted .cc-dtile-n { color: var(--cc-fg-primary); }
.cc-dtile-sub { font: 500 11px/1.3 var(--cc-sans); opacity: .85; }
.cc-dtile-muted .cc-dtile-sub { color: var(--cc-fg-muted); }
.cc-dtile-btn { cursor: pointer; }
.cc-dtile-btn:hover { filter: brightness(1.1); }

/* CARDS */
.cc-main-grid { display: grid; grid-template-columns: 1fr 420px; gap: 24px; }
.cc-three-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.cc-card { background: var(--cc-bg-surface); border: 1px solid var(--cc-border); border-radius: 14px; overflow: hidden; }
.cc-card-h { display: flex; align-items: center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid var(--cc-border-sub); flex-wrap: wrap; }
.cc-card-h h3 { font: 600 14px/1 var(--cc-sans); letter-spacing: -0.01em; margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cc-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--cc-bg-surface-2); border: 1px solid var(--cc-border); color: var(--cc-fg-secondary); font: 500 11px/1 var(--cc-sans); }
.cc-card-right { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--cc-fg-muted); font: 500 12px/1 var(--cc-sans); flex-wrap: wrap; }
.cc-filter { background: var(--cc-bg-surface-2); border: 1px solid var(--cc-border); border-radius: 8px; padding: 5px 10px; color: var(--cc-fg-secondary); font: 500 12px/1 var(--cc-sans); cursor: pointer; }
.cc-filter.on { background: var(--cc-bg-surface-3); color: var(--cc-fg-primary); border-color: var(--cc-border-str); }
.cc-live { display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: rgba(34,197,94,.1); border: 1px solid rgba(34,197,94,.3); border-radius: 999px; font: 500 11px/1 var(--cc-sans); }
.cc-live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cc-success); box-shadow: 0 0 8px var(--cc-success); animation: bk 1.2s infinite; display: inline-block; }

/* FEED */
.cc-feed-item { display: grid; grid-template-columns: 40px 1fr; gap: 12px; align-items: flex-start; padding: 14px 18px; border-bottom: 1px solid var(--cc-border-sub); position: relative; }
.cc-feed-item:last-child { border-bottom: 0; }
.cc-feed-item-btn { cursor: pointer; }
.cc-feed-item-btn:hover { background: var(--cc-bg-surface-2); }
.cc-feed-stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--c, transparent); opacity: .85; }
.cc-feed-av { width: 40px; height: 40px; border-radius: 10px; background: var(--cc-bg-surface-2); border: 1px solid var(--cc-border); display: grid; place-items: center; color: var(--c, var(--cc-fg-secondary)); font: 700 12px/1 var(--cc-sans); flex-shrink: 0; }
.cc-feed-body {}
.cc-feed-top { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.cc-feed-tag { font: 600 10px/1 var(--cc-sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--c, var(--cc-fg-muted)); }
.cc-feed-head { font: 600 13px/1.3 var(--cc-sans); color: var(--cc-fg-primary); margin-bottom: 4px; }
.cc-feed-desc { font: 400 12px/1.4 var(--cc-sans); color: var(--cc-fg-secondary); }

/* APPROVALS */
.cc-approve {}
.cc-appr { padding: 14px 18px; border-bottom: 1px solid var(--cc-border-sub); }
.cc-appr:last-child { border-bottom: 0; }
.cc-appr-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cc-appr-agent { display: flex; align-items: center; gap: 8px; font: 500 12px/1 var(--cc-sans); color: var(--cc-fg-secondary); }
.cc-appr-av { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font: 700 10px/1 var(--cc-sans); color: #fff; flex-shrink: 0; }
.cc-appr-agent b { color: var(--cc-fg-primary); }
.cc-kind { padding: 4px 10px; border-radius: 999px; font: 600 10px/1 var(--cc-sans); letter-spacing: 0.1em; text-transform: uppercase; background: color-mix(in oklab, var(--c, var(--cc-purple)) 14%, var(--cc-bg-surface)); color: var(--c, var(--cc-fg-secondary)); border: 1px solid color-mix(in oklab, var(--c, var(--cc-purple)) 30%, var(--cc-border)); }
.cc-appr-title { font: 600 13px/1.3 var(--cc-sans); color: var(--cc-fg-primary); margin-bottom: 6px; }
.cc-appr-meta { display: flex; gap: 12px; font: 500 11px/1 var(--cc-mono); color: var(--cc-fg-faint); margin-bottom: 10px; }
.cc-appr-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.cc-btn-s { padding: 6px 14px; border-radius: 8px; font: 600 12px/1 var(--cc-sans); border: 1px solid var(--cc-border); background: var(--cc-bg-surface-2); color: var(--cc-fg-secondary); cursor: pointer; }
.cc-btn-s:hover { border-color: var(--cc-border-str); color: var(--cc-fg-primary); }
.cc-btn-s:disabled { opacity: .5; cursor: default; }
.cc-go { background: rgba(34,197,94,.12); border-color: rgba(34,197,94,.35); color: #86efac; }
.cc-go:hover { background: rgba(34,197,94,.2); }
.cc-no { background: rgba(239,68,68,.1); border-color: rgba(239,68,68,.3); color: #fca5a5; }
.cc-no:hover { background: rgba(239,68,68,.2); }

/* AGENT OFFICE FLOOR */
.cc-agent-floor { display: grid; grid-template-columns: repeat(4, 1fr); }
.cc-agent-cell { padding: 16px 18px; border-right: 1px solid var(--cc-border-sub); border-bottom: 1px solid var(--cc-border-sub); display: flex; flex-direction: column; gap: 8px; position: relative; min-width: 0; transition: background 0.15s; }
.cc-agent-cell:hover { background: var(--cc-bg-surface-2); }
.cc-agent-cell:nth-child(4n) { border-right: 0; }
.cc-agent-cell:nth-last-child(-n+4) { border-bottom: 0; }
.cc-cell-top { display: flex; align-items: center; gap: 10px; }
.cc-cell-av { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font: 700 12px/1 var(--cc-sans); color: #fff; flex-shrink: 0; }
.cc-cell-nm { font: 600 13px/1 var(--cc-sans); }
.cc-cell-rl { font: 500 10px/1 var(--cc-sans); letter-spacing: 0.1em; text-transform: uppercase; color: var(--cc-fg-muted); margin-top: 3px; }
.cc-cell-status { font: 500 12px/1.35 var(--cc-sans); color: var(--cc-fg-secondary); }
.cc-cell-meter { display: flex; align-items: center; gap: 8px; font: 500 10px/1 var(--cc-mono); color: var(--cc-fg-muted); margin-top: auto; }
.cc-meter-bar { flex: 1; height: 4px; border-radius: 999px; background: var(--cc-bg-surface-2); overflow: hidden; }
.cc-meter-bar i { display: block; height: 100%; border-radius: 999px; }

/* STAT GRIDS */
.cc-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; padding: 16px 18px; }
.cc-stat-mini { background: var(--cc-bg-surface-2); border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; }
.cc-stat-mini-label { font: 600 9px/1 var(--cc-sans); letter-spacing: 0.14em; text-transform: uppercase; color: var(--cc-fg-faint); }
.cc-stat-mini-val { font: 600 18px/1 var(--cc-sans); letter-spacing: -0.01em; }
.cc-stat-mini-sub { font: 500 11px/1.3 var(--cc-sans); color: var(--cc-fg-muted); }

/* ROW ITEMS */
.cc-row-item { display: flex; align-items: center; gap: 10px; padding: 9px 18px; border-bottom: 1px solid var(--cc-border-sub); font: 500 12px/1 var(--cc-sans); }
.cc-row-item:last-child { border-bottom: 0; }
.cc-row-main { flex: 1; min-width: 0; color: var(--cc-fg-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cc-row-muted { color: var(--cc-fg-faint); font-family: var(--cc-mono); font-size: 10.5px; white-space: nowrap; flex-shrink: 0; }
.cc-chip { padding: 3px 8px; border-radius: 999px; font: 600 9px/1 var(--cc-sans); letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; flex-shrink: 0; }
.cc-empty { padding: 28px 20px; text-align: center; color: var(--cc-fg-muted); font: 400 13px/1.6 var(--cc-sans); }
.cc-link-btn { display: inline-flex; align-items: center; padding: 7px 14px; border-radius: 8px; background: var(--cc-bg-surface-2); border: 1px solid var(--cc-border); color: var(--cc-fg-muted); font: 500 12px/1 var(--cc-mono); text-decoration: none; cursor: pointer; }
.cc-link-btn:hover { color: var(--cc-fg-primary); border-color: var(--cc-border-str); }

/* QUICK ACTIONS */
.cc-quick-action { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: 10px; background: var(--cc-bg-surface-2); border: 1px solid var(--cc-border); font: 500 13px/1.3 var(--cc-sans); color: var(--cc-fg-primary); cursor: pointer; text-align: left; width: 100%; }
.cc-quick-action:hover { border-color: color-mix(in oklab, var(--c, var(--cc-purple)) 50%, var(--cc-border)); background: var(--cc-bg-surface-3); }
.cc-qa-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--cc-purple)); box-shadow: 0 0 6px var(--c, var(--cc-purple)); flex-shrink: 0; margin-top: 3px; }
.cc-quick-action small { display: block; font: 400 11px/1.3 var(--cc-mono); color: var(--cc-fg-faint); margin-top: 3px; }
.cc-toast { position: absolute; top: 56px; left: 50%; transform: translateX(-50%); background: var(--cc-bg-surface-3); border: 1px solid var(--cc-border-str); border-radius: 8px; padding: 8px 16px; font: 500 12px/1 var(--cc-mono); color: var(--cc-green-2); white-space: nowrap; z-index: 10; box-shadow: 0 4px 16px rgba(0,0,0,.4); pointer-events: none; }
.cc-toast b { color: var(--cc-fg-primary); }

/* FINANCE BARS (kept for dept strip compatibility) */
.cc-cost-bars { display: flex; flex-direction: column; gap: 10px; }

/* MOBILE NAV */
.cc-mobile-nav { display: none; }

/* ─ RESPONSIVE ─ */
@media (max-width: 1100px) {
  .cc-hero { grid-template-columns: 1fr; }
  .cc-office-card { min-height: 180px; max-height: 240px; }
  .cc-main-grid { grid-template-columns: 1fr; }
  .cc-agent-floor { grid-template-columns: repeat(2, 1fr); }
  .cc-agent-cell:nth-child(4n) { border-right: 0; }
  .cc-agent-cell:nth-child(2n) { border-right: 0; }
  .cc-agent-cell:nth-last-child(-n+4) { border-bottom: 1px solid var(--cc-border-sub); }
  .cc-agent-cell:nth-last-child(-n+2) { border-bottom: 0; }
  .cc-dept-strip { grid-template-columns: repeat(7, minmax(110px, 1fr)); }
  .cc-three-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 768px) {
  .cc-shell { grid-template-columns: 1fr; grid-template-rows: 56px 1fr; }
  .cc-topbar { grid-template-columns: 1fr auto; padding: 0 16px; gap: 10px; }
  .cc-brand { border-right: none; padding: 0; }
  .cc-brand-sub { display: none; }
  .cc-search { display: none; }
  .cc-rail { display: none; }
  .cc-canvas { padding: 16px 16px 80px; gap: 16px; }
  .cc-h1 { font-size: 24px; }
  .cc-sum { font-size: 14px; }
  .cc-dept-strip { display: flex; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; gap: 10px; padding-bottom: 2px; }
  .cc-dept-strip::-webkit-scrollbar { display: none; }
  .cc-dtile { min-width: 130px; flex-shrink: 0; }
  .cc-three-grid { grid-template-columns: 1fr; }
  .cc-mobile-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: var(--cc-bg-rail); border-top: 1px solid var(--cc-border); z-index: 30; padding: 8px 0 env(safe-area-inset-bottom, 8px); }
  .cc-nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; background: none; border: none; color: var(--cc-fg-muted); font: 500 10px/1 var(--cc-sans); cursor: pointer; }
  .cc-nav-btn.active { color: var(--cc-purple-2); }
  .cc-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
}
@media (max-width: 480px) {
  .cc-agent-floor { grid-template-columns: 1fr; }
  .cc-agent-cell { border-right: 0; }
  .cc-agent-cell:nth-last-child(-n+1) { border-bottom: 0; }
  .cc-agent-cell:nth-last-child(-n+2) { border-bottom: 1px solid var(--cc-border-sub); }
  .cc-stat-grid { grid-template-columns: 1fr 1fr !important; }
}
`;
