import { PrismaClient } from "@prisma/client";
import { DIRECT_DATABASE_URL } from "./direct-database-url";
import { reconcileInterPixSubscriptions } from "../src/server/tenant/reconcile";

const db = new PrismaClient({
  datasources: { db: { url: DIRECT_DATABASE_URL } },
});

async function main() {
  const summary = await reconcileInterPixSubscriptions(db);

  console.log(
    `verificadas: ${summary.checked}, corrigidas: ${summary.corrected}, divergentes: ${summary.diverged}, falhas: ${summary.failed}`,
  );
  console.log(
    "limitação conhecida: esta rotina parte das linhas do nosso banco, então uma assinatura " +
      "criada na InterPix que nunca foi gravada aqui — cobrando alguém sem nenhum registro " +
      "nosso — é invisível para ela. Só um endpoint de listagem no gateway resolveria isso, e " +
      "o cliente HTTP atual (src/server/tenant/interpix.ts) não expõe um.",
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
