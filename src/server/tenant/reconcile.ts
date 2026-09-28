import type { PrismaClient, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { decidePeriodEndCorrection, decideReconcile } from "./reconcile-status";
import { getInterPixSubscription } from "./interpix";

export type ReconcileSummary = { checked: number; corrected: number; diverged: number; failed: number };

export async function reconcileInterPixSubscriptions(
  client: PrismaClient = db,
  log: (line: string) => void = console.log,
): Promise<ReconcileSummary> {
  const subs = await client.subscription.findMany({
    where: {
      provider: "INTERPIX",
      interpixSubscriptionId: { not: null },
      status: { in: ["PENDING_AUTH", "ACTIVE", "PAST_DUE", "SUSPENDED"] },
    },
  });

  const summary: ReconcileSummary = { checked: 0, corrected: 0, diverged: 0, failed: 0 };

  for (const sub of subs) {
    summary.checked += 1;

    let remote: Awaited<ReturnType<typeof getInterPixSubscription>>;
    try {
      remote = await getInterPixSubscription(sub.interpixSubscriptionId as string);
    } catch (e) {
      summary.failed += 1;
      log(`falha ao consultar ${sub.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    try {
      const statusDecision = decideReconcile({ local: sub.status, remote: remote.status });
      const effectiveStatus = statusDecision.action === "apply" ? statusDecision.status : sub.status;
      const periodDecision = decidePeriodEndCorrection({
        localPeriodEnd: sub.currentPeriodEnd,
        remoteNextDueDate: remote.nextDueDate,
        priorLocalStatus: sub.status,
        effectiveStatus,
      });

      const data: {
        status?: SubscriptionStatus;
        currentPeriodEnd?: Date;
        lastPaidAt?: Date;
        paidThroughAt?: Date;
      } = {};

      if (statusDecision.action === "apply") {
        data.status = statusDecision.status;
        if (statusDecision.lastPaidAt) data.lastPaidAt = statusDecision.lastPaidAt;
      }

      if (periodDecision.action === "apply") {
        data.currentPeriodEnd = periodDecision.currentPeriodEnd;
        if (periodDecision.recordPaidThroughAt) data.paidThroughAt = periodDecision.currentPeriodEnd;
      }

      if (Object.keys(data).length > 0) {
        await client.subscription.update({ where: { id: sub.id }, data });
        summary.corrected += 1;
        log(
          `corrigida ${sub.id}: ${
            statusDecision.action === "apply" ? statusDecision.reason : "sem mudança de status"
          }${periodDecision.action === "apply" ? `; ${periodDecision.reason}` : ""}`,
        );
      }

      if (statusDecision.action === "report") {
        summary.diverged += 1;
        log(`divergência em ${sub.id}: ${statusDecision.reason}`);
      }
    } catch (e) {
      summary.failed += 1;
      log(`falha ao gravar ${sub.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}
