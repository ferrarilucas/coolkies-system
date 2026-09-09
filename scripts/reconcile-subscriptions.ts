import { PrismaClient, type SubscriptionStatus } from "@prisma/client";
import { DIRECT_DATABASE_URL } from "./direct-database-url";
import { decidePeriodEndCorrection, decideReconcile } from "./reconcile-status";
import { getInterPixSubscription } from "../src/server/tenant/interpix";

const db = new PrismaClient({
  datasources: { db: { url: DIRECT_DATABASE_URL } },
});

async function main() {
  const subs = await db.subscription.findMany({
    where: {
      provider: "INTERPIX",
      interpixSubscriptionId: { not: null },
      status: { in: ["PENDING_AUTH", "ACTIVE", "PAST_DUE", "SUSPENDED"] },
    },
  });

  let checked = 0;
  let corrected = 0;
  let diverged = 0;
  let failed = 0;

  for (const sub of subs) {
    checked += 1;

    let remote: Awaited<ReturnType<typeof getInterPixSubscription>>;
    try {
      remote = await getInterPixSubscription(sub.interpixSubscriptionId as string);
    } catch (e) {
      failed += 1;
      console.error(`falha ao consultar ${sub.id}:`, e instanceof Error ? e.message : e);
      continue;
    }

    try {
      const statusDecision = decideReconcile({ local: sub.status, remote: remote.status });
      const periodDecision = decidePeriodEndCorrection({
        localPeriodEnd: sub.currentPeriodEnd,
        remoteNextDueDate: remote.nextDueDate,
      });

      const data: { status?: SubscriptionStatus; currentPeriodEnd?: Date } = {};

      if (statusDecision.action === "apply") {
        data.status = statusDecision.status;
      }

      if (periodDecision.action === "apply") {
        data.currentPeriodEnd = periodDecision.currentPeriodEnd;
      }

      if (Object.keys(data).length > 0) {
        await db.subscription.update({ where: { id: sub.id }, data });
        corrected += 1;
        console.log(
          `corrigida ${sub.id}: ${
            statusDecision.action === "apply" ? statusDecision.reason : "sem mudança de status"
          }${periodDecision.action === "apply" ? `; ${periodDecision.reason}` : ""}`,
        );
      }

      if (statusDecision.action === "report") {
        diverged += 1;
        console.log(`divergência em ${sub.id}: ${statusDecision.reason}`);
      }
    } catch (e) {
      failed += 1;
      console.error(`falha ao gravar ${sub.id}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    `verificadas: ${checked}, corrigidas: ${corrected}, divergentes: ${diverged}, falhas: ${failed}`,
  );
  console.log(
    "limitação conhecida: esta rotina parte das linhas do nosso banco, então uma assinatura " +
      "criada na InterPix que nunca foi gravada aqui — cobrando alguém sem nenhum registro " +
      "nosso — é invisível para ela. Só um endpoint de listagem no gateway resolveria isso, e " +
      "o cliente HTTP atual (src/server/tenant/interpix.ts) não expõe um.",
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
