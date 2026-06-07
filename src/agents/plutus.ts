// Plutus — finance & spend
// Owns ONLY these tools (this is what enforces no-overlap): "finance.read","budget-cap","llm-cost-monitor","debt-tracker"
// CAN: track spend, LLM cost cap, debt progress, warn
// CANNOT: move money or make transactions — every function below only reads
// FinanceEntry (Osman's own manual log) and ModelUsage (real Groq call records).

import {
  financeRead,
  budgetCap,
  llmCostMonitor,
  debtTracker,
  type FinanceSnapshot,
  type BudgetStatus,
  type CostMonitorReport,
  type DebtProgress,
} from "@/lib/finance";

export const plutus = {
  name: "Plutus",
  domain: "finance & spend",
  tools: ["finance.read", "budget-cap", "llm-cost-monitor", "debt-tracker"] as const,
};

export interface PlutusReport {
  finance: FinanceSnapshot;
  budget: BudgetStatus;
  costs: CostMonitorReport;
  debt: DebtProgress;
}

/** Aggregates all four owned tools into one view for the dashboard. */
export async function plutusReport(userId: string): Promise<PlutusReport> {
  const [finance, budget, costs, debt] = await Promise.all([
    financeRead(userId),
    budgetCap(userId),
    llmCostMonitor(userId),
    debtTracker(userId),
  ]);
  return { finance, budget, costs, debt };
}

export { financeRead, budgetCap, llmCostMonitor, debtTracker };
