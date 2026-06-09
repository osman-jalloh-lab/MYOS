import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listApprovals } from "@/lib/approvals";
import { listTasks } from "@/lib/tasks";
import { plutusReport } from "@/agents/plutus";
import { appTrackerSummary } from "@/agents/athena";
import { readMemory } from "@/agents/mnemosyne";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const userName = session?.user?.name?.split(" ")[0] ?? "Osman";

  const [accounts, pendingApprovals, tasks, plutus, athena, memories, sophosBrief] =
    await Promise.all([
      userId
        ? prisma.googleAccount.findMany({
            where: { userId },
            select: { id: true, email: true, label: true, isDefault: true },
            orderBy: { createdAt: "asc" },
          })
        : Promise.resolve([]),
      userId ? listApprovals(userId, "pending") : Promise.resolve([]),
      userId ? listTasks(userId, { status: "open" }) : Promise.resolve([]),
      userId ? plutusReport(userId).catch(() => null) : Promise.resolve(null),
      userId ? appTrackerSummary(userId).catch(() => null) : Promise.resolve(null),
      userId ? readMemory(userId).catch(() => []) : Promise.resolve([]),
      userId
        ? prisma.agentRun
            .findFirst({
              where: { agentName: "sophos" },
              orderBy: { createdAt: "desc" },
              select: { outputSummary: true, createdAt: true },
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

  return (
    <HomeClient
      userName={userName}
      isAuthenticated={!!userId}
      initialAgent={params.agent ?? null}
      pendingApprovals={pendingApprovals}
      tasks={tasks}
      finIncome={plutus?.finance.income ?? 0}
      finExpenses={plutus?.finance.expenses ?? 0}
      finNet={plutus?.finance.net ?? 0}
      finLlmSpent={plutus?.budget.spentUsd ?? 0}
      finLlmCap={plutus?.budget.capUsd ?? 0}
      finLlmPct={plutus?.budget.percentUsed ?? 0}
      finLlmLevel={plutus?.budget.level ?? "ok"}
      finTotalCalls={plutus?.costs.totalCalls ?? 0}
      finByCategory={plutus?.finance.byCategory ?? []}
      finDebtPct={plutus?.debt.percentPaidOff ?? null}
      finDebtBalance={plutus?.debt.currentBalance ?? null}
      finDebtPaid={plutus?.debt.totalPaid ?? 0}
      accounts={accounts}
      memories={memories}
      athena={
        athena
          ? { byStatus: athena.byStatus as Record<string, number>, recent: athena.recent }
          : null
      }
      sophosBrief={
        sophosBrief
          ? { outputSummary: sophosBrief.outputSummary, createdAt: sophosBrief.createdAt.toISOString() }
          : null
      }
    />
  );
}
