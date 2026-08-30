import { PrismaClient } from "@prisma/client";
import { DOMAIN_TABLES } from "./domain-tables";

const db = new PrismaClient();

async function main() {
  const ownerEmail = process.argv[2]?.trim().toLowerCase();
  if (!ownerEmail) {
    throw new Error("Uso: npm run backfill -- <email-do-owner>");
  }

  const result = await db.$transaction(
    async (tx) => {
      const owner = await tx.user.findUnique({ where: { email: ownerEmail } });
      if (!owner) {
        throw new Error(`Nenhum usuário com o e-mail ${ownerEmail}. Backfill abortado.`);
      }

      const existing = await tx.workspace.findUnique({ where: { slug: "douce-vie" } });
      if (existing) {
        throw new Error("Workspace douce-vie já existe. Backfill abortado.");
      }

      const workspace = await tx.workspace.create({
        data: { name: "Douce Vie", slug: "douce-vie" },
      });

      await tx.member.create({
        data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
      });

      const others = await tx.user.findMany({ where: { id: { not: owner.id } } });
      if (others.length > 0) {
        await tx.member.createMany({
          data: others.map((user) => ({
            userId: user.id,
            workspaceId: workspace.id,
            role: "MEMBER" as const,
          })),
        });
      }

      const counts: { table: string; rows: number }[] = [];
      for (const table of DOMAIN_TABLES) {
        const updated = await tx.$executeRawUnsafe(
          `UPDATE "${table}" SET "workspaceId" = $1 WHERE "workspaceId" IS NULL`,
          workspace.id,
        );
        counts.push({ table, rows: updated });
      }

      return { workspace, ownerEmail: owner.email, othersCount: others.length, counts };
    },
    { timeout: 120000, maxWait: 10000 },
  );

  for (const { table, rows } of result.counts) {
    console.log(`${table}: ${rows} linhas`);
  }

  console.log(`\nWorkspace Douce Vie criado: ${result.workspace.id}`);
  console.log(`Owner: ${result.ownerEmail}`);
  console.log(`Membros adicionais: ${result.othersCount}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
