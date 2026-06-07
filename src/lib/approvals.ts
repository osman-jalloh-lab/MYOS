// Approval queue — the gate every agent write passes through.
// Per CLAUDE.md rule 3 / master spec section 7: nothing writes silently.
// An ApprovalAction moves pending -> approved|rejected, and only an
// *approved* action may ever be executed against a real external system.
import { prisma } from "./db";

export type ApprovalActionType =
  | "draft_email"
  | "send_email"
  | "create_event"
  | "create_task"
  | "label_email"
  | "save_memory"
  | "delete_memory"
  | "apply_to_job";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed";

export interface ApprovalActionView {
  id: string;
  actionType: ApprovalActionType;
  payload: unknown;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt: string | null;
  executionNote?: string;
}

function toView(row: {
  id: string;
  actionType: string;
  payload: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
}): ApprovalActionView {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = row.payload;
  }
  return {
    id: row.id,
    actionType: row.actionType as ApprovalActionType,
    payload,
    status: row.status as ApprovalStatus,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function listApprovals(
  userId: string,
  status?: ApprovalStatus
): Promise<ApprovalActionView[]> {
  const rows = await prisma.approvalAction.findMany({
    where: { userId, ...(status && { status }) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toView);
}

// Scopes Iris/Kairos hold today are read-only (calendar.readonly, gmail.readonly).
// Action types below require write scopes that were deliberately not requested
// in Phase 3 (see decisions_log "Phase 3 partial, by request"). Approving these
// queues Osman's intent; actually executing them waits on a future re-consent
// flow that adds gmail.compose/gmail.send/calendar write scopes.
const SCOPE_BLOCKED: Record<ApprovalActionType, string | null> = {
  draft_email: "Requires gmail.compose — not yet granted (read-only Gmail scope per Phase 3 decision).",
  send_email: "Requires gmail.send — not yet granted, and email sends should stay manual per master-spec section 7 ('never fully automate sending sensitive emails').",
  create_event: "Requires calendar write scope — not yet granted (calendar.readonly only).",
  create_task: null,
  label_email: "Requires gmail.modify — not yet granted (read-only Gmail scope per Phase 3 decision).",
  save_memory: null,
  delete_memory: null,
  apply_to_job: "Job applications must always stay manual per master-spec section 7 ('never fully automate job applications').",
};

export async function approveAction(userId: string, id: string): Promise<ApprovalActionView> {
  const row = await prisma.approvalAction.findFirstOrThrow({ where: { id, userId } });
  if (row.status !== "pending") throw new Error(`Action is already ${row.status}`);

  const updated = await prisma.approvalAction.update({
    where: { id },
    data: { status: "approved", resolvedAt: new Date() },
  });

  return executeIfPossible(updated);
}

export async function rejectAction(userId: string, id: string): Promise<ApprovalActionView> {
  const row = await prisma.approvalAction.findFirstOrThrow({ where: { id, userId } });
  if (row.status !== "pending") throw new Error(`Action is already ${row.status}`);

  const updated = await prisma.approvalAction.update({
    where: { id },
    data: { status: "rejected", resolvedAt: new Date() },
  });
  return toView(updated);
}

// Executes an approved action if Hermes currently holds the scopes/tools to do
// so safely. Most write actions are blocked today by design (see SCOPE_BLOCKED) —
// they stay "approved" (Osman's intent is logged) until the underlying capability
// exists, at which point a future pass can pick up approved-but-unexecuted rows.
async function executeIfPossible(row: {
  id: string;
  userId: string;
  actionType: string;
  payload: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
}): Promise<ApprovalActionView> {
  const actionType = row.actionType as ApprovalActionType;
  const blockedReason = SCOPE_BLOCKED[actionType];

  if (blockedReason) {
    const view = toView(row);
    view.executionNote = `Approved — execution held: ${blockedReason}`;
    return view;
  }

  // create_task / save_memory only ever touch our own DB — safe to execute
  // immediately once approved, since they hold no external write power.
  if (actionType === "create_task") {
    const payload = JSON.parse(row.payload) as {
      title: string;
      description?: string;
      dueAt?: string;
      source?: string;
      sourceRef?: string;
      priority?: string;
    };
    await prisma.task.create({
      data: {
        userId: row.userId,
        title: payload.title,
        description: payload.description,
        dueAt: payload.dueAt ? new Date(payload.dueAt) : undefined,
        source: payload.source,
        sourceRef: payload.sourceRef,
        priority: payload.priority ?? "medium",
      },
    });
  }

  if (actionType === "save_memory") {
    const payload = JSON.parse(row.payload) as { fact: string; source?: string };
    await prisma.memory.create({
      data: {
        userId: row.userId,
        fact: payload.fact,
        source: payload.source,
        approvedAt: new Date(),
      },
    });
  }

  if (actionType === "delete_memory") {
    const payload = JSON.parse(row.payload) as { memoryId: string };
    await prisma.memory.deleteMany({ where: { id: payload.memoryId, userId: row.userId } });
  }

  const executed = await prisma.approvalAction.update({
    where: { id: row.id },
    data: { status: "executed" },
  });
  const view = toView(executed);
  view.executionNote = "Approved and executed.";
  return view;
}

export async function createApproval(
  userId: string,
  actionType: ApprovalActionType,
  payload: unknown
): Promise<ApprovalActionView> {
  const row = await prisma.approvalAction.create({
    data: { userId, actionType, payload: JSON.stringify(payload) },
  });
  return toView(row);
}

export async function approvalCounts(userId: string): Promise<Record<ApprovalStatus, number>> {
  const rows = await prisma.approvalAction.groupBy({
    by: ["status"],
    where: { userId },
    _count: { status: true },
  });
  const counts: Record<ApprovalStatus, number> = { pending: 0, approved: 0, rejected: 0, executed: 0 };
  for (const r of rows) counts[r.status as ApprovalStatus] = r._count.status;
  return counts;
}
