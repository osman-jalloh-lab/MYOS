import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { plutusReport } from "@/agents/plutus";

/**
 * GET /api/finance
 * Returns Plutus's full read-only report: this month's income/expense
 * snapshot, the Groq spend vs. budget cap, the cost breakdown by provider
 * and task type, and debt-payoff progress. Plutus never moves money — every
 * field here is aggregated from FinanceEntry (Osman's manual log) and
 * ModelUsage (real logged LLM calls).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await plutusReport(session.user.id);
  return NextResponse.json(report);
}
