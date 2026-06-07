import { prisma } from "@/lib/db";
import { morningBrief } from "@/agents/argus";
import { approvalCounts } from "@/lib/approvals";
import { listTasks } from "@/lib/tasks";

/**
 * Persistent "what do I need to do today" panel — separate from the Hermes
 * conversation. Server-rendered: pulls the same read paths the dashboard
 * sections already use (Argus's brief, the Task table, the approval queue,
 * Sophos's latest digest), no new data plumbing.
 */
export default async function BriefingSidebar({ userId }: { userId: string }) {
  const [brief, tasks, counts, sophosBrief] = await Promise.all([
    morningBrief(userId).catch(() => null),
    listTasks(userId, { status: "open" }),
    approvalCounts(userId),
    prisma.agentRun.findFirst({
      where: { agentName: "sophos", createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const todayTasks = tasks.slice(0, 5);

  return (
    <aside style={wrap}>
      <div style={label}>TODAY</div>

      <section className="glass-panel" style={card}>
        <div style={{ ...sectionLabel, color: "var(--argus)" }}>BRIEFING</div>
        <p style={text}>
          {brief?.text
            ? brief.text.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ")
            : "Nothing synthesized yet today — open the dashboard brief section to generate one."}
        </p>
      </section>

      <section className="glass-panel" style={card}>
        <div style={{ ...sectionLabel, color: "var(--hermes)" }}>OPEN TASKS</div>
        {todayTasks.length === 0 ? (
          <p style={muted}>Nothing open right now.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {todayTasks.map((t) => (
              <div key={t.id} style={taskRow}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--hermes)", flexShrink: 0 }} />
                <span style={taskTitle}>{t.title}</span>
                {t.assignedAgent && <span style={agentTag}>{t.assignedAgent}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="glass-panel" style={card}>
        <div style={{ ...sectionLabel, color: "var(--hermes)" }}>APPROVALS</div>
        <a href="/approvals" style={approvalLink}>
          <span style={{ fontSize: 22, fontFamily: "var(--serif)", fontWeight: 600 }}>{counts.pending ?? 0}</span>
          <span style={muted}>pending your review →</span>
        </a>
      </section>

      {sophosBrief && (
        <section className="glass-panel" style={card}>
          <div style={{ ...sectionLabel, color: "var(--sophos)" }}>WHAT'S NEW</div>
          <p style={text}>{(sophosBrief.outputSummary ?? "").slice(0, 220)}</p>
        </section>
      )}
    </aside>
  );
}

const wrap: React.CSSProperties = {
  background: "linear-gradient(180deg,#0c0c10,#0a0a0d)",
  borderLeft: "1px solid var(--line)",
  padding: "20px 16px",
  display: "flex", flexDirection: "column", gap: 12,
  overflowY: "auto",
};

const label: React.CSSProperties = {
  fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "1.6px",
  color: "var(--faint)", margin: "0 4px 2px",
};

const card: React.CSSProperties = {
  borderRadius: 12, padding: "12px 14px",
};

const sectionLabel: React.CSSProperties = {
  fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "1.4px",
  marginBottom: 8,
};

const text: React.CSSProperties = { fontSize: 12, lineHeight: 1.6, color: "var(--text)" };

const muted: React.CSSProperties = { fontSize: 11.5, color: "var(--faint)" };

const taskRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };

const taskTitle: React.CSSProperties = {
  fontSize: 12, color: "var(--text)", flex: 1,
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const agentTag: React.CSSProperties = {
  fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".3px",
  color: "var(--faint)", background: "rgba(255,255,255,.05)",
  padding: "2px 6px", borderRadius: 5, textTransform: "uppercase", flexShrink: 0,
};

const approvalLink: React.CSSProperties = {
  display: "flex", alignItems: "baseline", gap: 8,
  color: "var(--hermes)", textDecoration: "none",
};
