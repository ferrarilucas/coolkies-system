import { PrismaClient } from "@prisma/client";
import { DOMAIN_TABLES } from "./domain-tables";
import { DIRECT_DATABASE_URL } from "./direct-database-url";

const db = new PrismaClient({
  datasources: { db: { url: DIRECT_DATABASE_URL } },
});

async function main() {
  const offenders: Array<{ table: string; count: number }> = [];

  for (const table of DOMAIN_TABLES) {
    const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint as count FROM "${table}" WHERE "workspaceId" IS NULL`,
    );
    const count = Number(rows[0].count);
    if (count > 0) offenders.push({ table, count });
  }

  if (offenders.length > 0) {
    console.error("Backfill incompleto. Nao rode a migration de aperto.\n");
    for (const { table, count } of offenders) {
      console.error(`  ${table}: ${count} linhas sem workspaceId`);
    }
    process.exit(1);
  }

  console.log(`Backfill verificado: ${DOMAIN_TABLES.length} tabelas sem pendencias.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
