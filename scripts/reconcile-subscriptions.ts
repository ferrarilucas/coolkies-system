import { PrismaClient } from "@prisma/client";
import { DIRECT_DATABASE_URL } from "./direct-database-url";
import { decideReconcile } from "./reconcile-status";
import { listAsaasPaymentsOfSubscription } from "../src/server/tenant/asaas";

const db = new PrismaClient({
  datasources: { db: { url: DIRECT_DATABASE_URL } },
});

async function main() {
  const subs = await db.subscription.findMany({
    where: { source: "ASAAS", asaasSubscriptionId: { not: null } },
  });

  let checked = 0;
  let activated = 0;
  let reported = 0;
  let failed = 0;
  const now = new Date();

  for (const sub of subs) {
    checked += 1;
    try {
      const charges = await listAsaasPaymentsOfSubscription(sub.asaasSubscriptionId as string);
      const decision = decideReconcile({
        localStatus: sub.status,
        cycle: sub.cycle,
        charges,
        now,
      });

      if (decision.action === "activate") {
        await db.subscription.update({
          where: { id: sub.id },
          data: { status: "ACTIVE", graceUntil: null },
        });
        activated += 1;
        console.log(`ativada ${sub.id}: ${sub.status} -> ACTIVE (${decision.reason})`);
        continue;
      }

      if (decision.action === "report") {
        reported += 1;
        console.log(`divergencia em ${sub.id}: ${decision.reason}`);
      }
    } catch (e) {
      failed += 1;
      console.error(`falha ao consultar ${sub.id}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    `verificadas: ${checked}, ativadas: ${activated}, divergencias: ${reported}, falhas: ${failed}`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
