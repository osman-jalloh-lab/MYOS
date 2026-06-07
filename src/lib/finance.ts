// Finance data layer for Plutus. Plutus only ever reads, aggregates, and warns —
// it never moves money or creates transactions (no payment-API integration
// exists or is planned, per master-spec section 3 "CANNOT: move money").
import { prisma } from "./db";

export type FinanceEntryKind = "income" | "expense" | "debt_balance" | "debt_payment";

export interface FinanceEntryInput {
  kind: FinanceEntryKind;
  amountUsd: number;
  category?: string;
  description?: string;
  occurredAt?: Date;
}

export async function addEntry(userId: string, input: FinanceEntryInput) {
  return prisma.financeEntry.create({
    data: {
      userId,
      kind: input.kind,
      amountUsd: input.amountUsd,
      category: input.category,
      description: input.description,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}

export interface FinanceSnapshot {
  periodStart: string;
  periodEnd: string;
  income: number;
  expenses: number;
  net: number;
  byCategory: { category: string; total: number }[];
  debtBalance: number | null;
  debtPaidThisPeriod: number;
}

/** finance.read — aggregates this month's income/expense/debt activity. */
export async function financeRead(userId: string, monthsBack = 0): Promise<FinanceSnapshot> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0, 23, 59, 59, 999);

  const entries = await prisma.financeEntry.findMany({
    where: { userId, occurredAt: { gte: periodStart, lte: periodEnd } },
    orderBy: { occurredAt: "desc" },
  });

  let income = 0;
  let expenses = 0;
  let debtPaidThisPeriod = 0;
  const categoryTotals = new Map<string, number>();

  for (const e of entries) {
    if (e.kind === "income") income += e.amountUsd;
    if (e.kind === "expense") {
      expenses += e.amountUsd;
      const cat = e.category ?? "uncategorized";
      categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + e.amountUsd);
    }
    if (e.kind === "debt_payment") debtPaidThisPeriod += e.amountUsd;
  }

  const latestDebtBalance = await prisma.financeEntry.findFirst({
    where: { userId, kind: "debt_balance" },
    orderBy: { occurredAt: "desc" },
  });

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    income,
    expenses,
    net: income - expenses,
    byCategory: [...categoryTotals.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total),
    debtBalance: latestDebtBalance?.amountUsd ?? null,
    debtPaidThisPeriod,
  };
}

export interface DebtProgress {
  currentBalance: number | null;
  startingBalance: number | null;
  totalPaid: number;
  percentPaidOff: number | null;
  history: { date: string; balance: number }[];
}

/** debt-tracker — traces debt_balance snapshots and cumulative debt_payment entries. */
export async function debtTracker(userId: string): Promise<DebtProgress> {
  const balances = await prisma.financeEntry.findMany({
    where: { userId, kind: "debt_balance" },
    orderBy: { occurredAt: "asc" },
  });
  const payments = await prisma.financeEntry.findMany({
    where: { userId, kind: "debt_payment" },
  });

  const totalPaid = payments.reduce((sum, p) => sum + p.amountUsd, 0);
  const starting = balances[0]?.amountUsd ?? null;
  const current = balances[balances.length - 1]?.amountUsd ?? null;
  const percentPaidOff =
    starting !== null && current !== null && starting > 0
      ? Math.max(0, Math.min(100, ((starting - current) / starting) * 100))
      : null;

  return {
    currentBalance: current,
    startingBalance: starting,
    totalPaid,
    percentPaidOff,
    history: balances.map((b) => ({ date: b.occurredAt.toISOString(), balance: b.amountUsd })),
  };
}

export interface CostMonitorReport {
  periodStart: string;
  periodEnd: string;
  totalCostUsd: number;
  totalCalls: number;
  byProvider: { provider: string; calls: number; costUsd: number }[];
  byTaskType: { taskType: string; calls: number; costUsd: number }[];
}

/** llm-cost-monitor — aggregates real model_usage rows for the current month. */
export async function llmCostMonitor(userId: string): Promise<CostMonitorReport> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const rows = await prisma.modelUsage.findMany({
    where: { userId, createdAt: { gte: periodStart, lte: periodEnd } },
  });

  const byProvider = new Map<string, { calls: number; costUsd: number }>();
  const byTaskType = new Map<string, { calls: number; costUsd: number }>();
  let totalCostUsd = 0;

  for (const r of rows) {
    const cost = r.estCostUsd ?? 0;
    totalCostUsd += cost;

    const p = byProvider.get(r.provider) ?? { calls: 0, costUsd: 0 };
    p.calls += 1;
    p.costUsd += cost;
    byProvider.set(r.provider, p);

    const taskType = r.taskType ?? "unspecified";
    const t = byTaskType.get(taskType) ?? { calls: 0, costUsd: 0 };
    t.calls += 1;
    t.costUsd += cost;
    byTaskType.set(taskType, t);
  }

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    totalCostUsd,
    totalCalls: rows.length,
    byProvider: [...byProvider.entries()].map(([provider, v]) => ({ provider, ...v })),
    byTaskType: [...byTaskType.entries()].map(([taskType, v]) => ({ taskType, ...v })),
  };
}

export interface BudgetStatus {
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
  level: "ok" | "warning" | "over";
}

const WARNING_THRESHOLD = 0.8;

/** budget-cap — compares this month's LLM spend against MONTHLY_BUDGET_CAP. */
export async function budgetCap(userId: string): Promise<BudgetStatus> {
  const capUsd = Number(process.env.MONTHLY_BUDGET_CAP ?? "10");
  const { totalCostUsd } = await llmCostMonitor(userId);

  const percentUsed = capUsd > 0 ? (totalCostUsd / capUsd) * 100 : 0;
  const level: BudgetStatus["level"] =
    totalCostUsd > capUsd ? "over" : percentUsed >= WARNING_THRESHOLD * 100 ? "warning" : "ok";

  return {
    capUsd,
    spentUsd: totalCostUsd,
    remainingUsd: Math.max(0, capUsd - totalCostUsd),
    percentUsed,
    level,
  };
}
