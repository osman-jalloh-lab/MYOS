import { prisma } from "@/lib/db";

// Logs directly to AgentRun rather than importing Hermes.logHandoff() — hermes.ts
// imports createTask/routeMessage's assignment branch from this module, so importing
// back would create a cycle. Same table, same shape, just written inline.
async function logHandoff(params: { agentName: string; inputSummary?: string; outputSummary?: string }): Promise<void> {
  await prisma.agentRun.create({
    data: { agentName: params.agentName, inputSummary: params.inputSummary, outputSummary: params.outputSummary },
  });
}

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  assignedAgent: string | null;
  delegatedBy: string | null;
  source: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

function toView(row: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: Date | null;
  assignedAgent: string | null;
  delegatedBy: string | null;
  source: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}): TaskView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    assignedAgent: row.assignedAgent,
    delegatedBy: row.delegatedBy,
    source: row.source,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createTask(
  userId: string,
  params: {
    title: string;
    description?: string;
    assignedAgent?: string | null;
    delegatedBy?: string | null;
    dueAt?: Date | null;
    priority?: string;
    source?: string;
    sourceRef?: string;
  }
): Promise<TaskView> {
  const row = await prisma.task.create({
    data: {
      userId,
      title: params.title,
      description: params.description,
      assignedAgent: params.assignedAgent ?? null,
      delegatedBy: params.delegatedBy ?? null,
      dueAt: params.dueAt ?? null,
      priority: params.priority ?? "medium",
      source: params.source,
      sourceRef: params.sourceRef,
    },
  });
  return toView(row);
}

export async function listTasks(
  userId: string,
  filter: { agent?: string; status?: string } = {}
): Promise<TaskView[]> {
  const rows = await prisma.task.findMany({
    where: {
      userId,
      ...(filter.agent ? { assignedAgent: filter.agent } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(toView);
}

export async function assignTask(userId: string, taskId: string, agentName: string): Promise<TaskView> {
  const row = await prisma.task.update({
    where: { id: taskId, userId },
    data: { assignedAgent: agentName, delegatedBy: "osman", status: "in_progress" },
  });
  await logHandoff({
    agentName: "hermes",
    inputSummary: `assigned task "${row.title}" to ${agentName}`,
    outputSummary: `task ${row.id} now owned by ${agentName}`,
  });
  return toView(row);
}

export async function delegateTask(
  userId: string,
  taskId: string,
  fromAgent: string,
  toAgent: string,
  reason?: string
): Promise<TaskView> {
  const row = await prisma.task.update({
    where: { id: taskId, userId },
    data: { assignedAgent: toAgent, delegatedBy: fromAgent },
  });
  await logHandoff({
    agentName: fromAgent,
    inputSummary: `handed off task "${row.title}" to ${toAgent}${reason ? ` — ${reason}` : ""}`,
    outputSummary: `task ${row.id} reassigned to ${toAgent}`,
  });
  return toView(row);
}

export async function completeTask(userId: string, taskId: string): Promise<TaskView> {
  const row = await prisma.task.update({
    where: { id: taskId, userId },
    data: { status: "done", resolvedAt: new Date() },
  });
  return toView(row);
}
