import { PrismaClient } from "@prisma/client";
import { DOMAIN_TABLES } from "./domain-tables";

const db = new PrismaClient();

async function main() {
  const ownerEmail = process.argv[2]?.trim().toLowerCase();
  if (!ownerEmail) {
    throw new Error("Uso: npm run backfill -- <email-do-owner>");
  }

  const owner = await db.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    throw new Error(`Nenhum usuário com o e-mail ${ownerEmail}. Backfill abortado.`);
  }

  const existing = await db.workspace.findUnique({ where: { slug: "douce-vie" } });
  if (existing) {
    throw new Error("Workspace douce-vie já existe. Backfill abortado.");
  }

  const workspace = await db.workspace.create({
    data: { name: "Douce Vie", slug: "douce-vie" },
  });

  await db.member.create({
    data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
  });

  const others = await db.user.findMany({ where: { id: { not: owner.id } } });
  if (others.length > 0) {
    await db.member.createMany({
      data: others.map((user) => ({
        userId: user.id,
        workspaceId: workspace.id,
        role: "MEMBER" as const,
      })),
    });
  }

  for (const table of DOMAIN_TABLES) {
    const updated = await db.$executeRawUnsafe(
      `UPDATE "${table}" SET "workspaceId" = $1 WHERE "workspaceId" IS NULL`,
      workspace.id,
    );
    console.log(`${table}: ${updated} linhas`);
  }

  console.log(`\nWorkspace Douce Vie criado: ${workspace.id}`);
  console.log(`Owner: ${owner.email}`);
  console.log(`Membros adicionais: ${others.length}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
