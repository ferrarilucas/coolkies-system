import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { canWriteInWorkspace } from "./subscription";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

function migrationSql(suffix: string): string {
  const dir = readdirSync(MIGRATIONS_DIR).find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`migration ${suffix} não encontrada`);
  return readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
}

function interpixSql(): string {
  return migrationSql("_interpix_provider");
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

async function runInterpixBackfill(): Promise<void> {
  const backfillStatements = stripSqlComments(interpixSql())
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.toUpperCase().startsWith("UPDATE"));
  for (const statement of backfillStatements) {
    await testDb.$executeRawUnsafe(`${statement};`);
  }
}

describe("migração para InterPix", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("o arquivo começa com comentário SQL", () => {
    expect(interpixSql().trimStart().startsWith("--")).toBe(true);
  });

  it("o dono pré-billing continua MANUAL e continua escrevendo", async () => {
    const user = await testDb.user.create({
      data: { id: "u-mig", name: "Dona", email: "mig@example.com" },
    });
    const ws = await testDb.workspace.create({
      data: { name: "Douce Vie", slug: "douce-vie-mig" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "MANUAL",
        status: "ACTIVE",
      },
    });

    expect(await canWriteInWorkspace(ws.id)).toBe(true);

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.provider).toBe("MANUAL");
  });

  it("linha residual ASAAS vira MANUAL e ganha nota explicando a origem", async () => {
    const user = await testDb.user.create({
      data: { id: "u-asaas-residual", name: "Residual", email: "residual@example.com" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        source: "ASAAS",
        provider: "INTERPIX",
        status: "ACTIVE",
      },
    });

    await runInterpixBackfill();

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.provider).toBe("MANUAL");
    expect(sub?.notes).toContain("Migracao InterPix");
  });

  it("traduz os ids antigos do catálogo para os novos", async () => {
    const owner = await testDb.user.create({
      data: { id: "u-catalogo", name: "Catalogo", email: "catalogo@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: owner.id, plan: "team", source: "MANUAL", status: "ACTIVE" },
    });

    await runInterpixBackfill();

    const sub = await testDb.subscription.findUnique({ where: { userId: owner.id } });
    expect(sub?.plan).toBe("cresce");
  });

  it("o backfill da base pré-billing (migration histórica) mais a tradução de ids do InterPix deixam o dono com o id novo e com acesso", async () => {
    const backfillSql = migrationSql("_backfill_manual_subscriptions");

    const owner = await testDb.user.create({
      data: { id: "u-e2e", name: "Dona E2E", email: "e2e@example.com" },
    });
    const ws1 = await testDb.workspace.create({ data: { name: "WS 1", slug: "ws-e2e-1" } });
    const ws2 = await testDb.workspace.create({ data: { name: "WS 2", slug: "ws-e2e-2" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws1.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws2.id, role: "OWNER" } });

    expect(await canWriteInWorkspace(ws1.id)).toBe(false);

    await testDb.$executeRawUnsafe(backfillSql);
    await runInterpixBackfill();

    const sub = await testDb.subscription.findUnique({ where: { userId: owner.id } });
    expect(sub?.plan).toBe("cresce");
    expect(sub?.provider).toBe("MANUAL");
    expect(await canWriteInWorkspace(ws1.id)).toBe(true);
    expect(await canWriteInWorkspace(ws2.id)).toBe(true);
  });
});
