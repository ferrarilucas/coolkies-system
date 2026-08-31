import { PrismaClient } from "@prisma/client";
import { DIRECT_DATABASE_URL } from "./direct-database-url";
import { expectedStatusFor } from "./reconcile-status";
import { getAsaasSubscription } from "../src/server/tenant/asaas";

const db = new PrismaClient({
  datasources: { db: { url: DIRECT_DATABASE_URL } },
});

async function main() {
  const subs = await db.subscription.findMany({
    where: { source: "ASAAS", asaasSubscriptionId: { not: null } },
  });

  let checked = 0;
  let corrected = 0;
  let failed = 0;
  let unknown = 0;

  for (const sub of subs) {
    checked += 1;
    try {
      const remote = await getAsaasSubscription(sub.asaasSubscriptionId as string);
      const expected = expectedStatusFor(remote.status);

      if (expected === null) {
        unknown += 1;
        console.log(`status remoto desconhecido para ${sub.id}: ${remote.status}`);
        continue;
      }

      if (sub.status !== expected && sub.status !== "CANCELED") {
        await db.subscription.update({
          where: { id: sub.id },
          data: { status: expected },
        });
        corrected += 1;
        console.log(`corrigido ${sub.id}: ${sub.status} -> ${expected}`);
      }
    } catch (e) {
      failed += 1;
      console.error(`falha ao consultar ${sub.id}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    `verificadas: ${checked}, corrigidas: ${corrected}, falhas: ${failed}, desconhecidas: ${unknown}`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
