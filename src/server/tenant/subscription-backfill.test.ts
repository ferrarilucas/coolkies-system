import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { canWriteInWorkspace } from "./subscription";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const MIGRATION_SUFFIX = "_backfill_manual_subscriptions";

function backfillSql(): string {
  const dir = readdirSync(MIGRATIONS_DIR).find((name) =>
    name.endsWith(MIGRATION_SUFFIX),
  );
  if (!dir) throw new Error("migration de backfill nao encontrada");
  return readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
}

async function runBackfill(): Promise<void> {
  await testDb.$executeRawUnsafe(backfillSql());
}

async function ownerWithWorkspaces(
  userId: string,
  email: string,
  count: number,
): Promise<string[]> {
  await testDb.user.create({ data: { id: userId, name: "Dona", email } });

  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const ws = await testDb.workspace.create({
      data: { name: `WS ${i}`, slug: `${userId}-${i}` },
    });
    await testDb.member.create({
      data: { userId, workspaceId: ws.id, role: "OWNER" },
    });
    ids.push(ws.id);
  }
  return ids;
}

describe("backfill de assinatura da base pre-billing", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("o arquivo da migration comeca com comentario SQL", () => {
    expect(backfillSql().startsWith("--")).toBe(true);
  });

  it("dono sem assinatura volta a poder escrever depois do backfill", async () => {
    const [workspaceId] = await ownerWithWorkspaces("u-backfill", "backfill@example.com", 1);

    expect(await canWriteInWorkspace(workspaceId)).toBe(false);

    await runBackfill();

    const sub = await testDb.subscription.findUnique({ where: { userId: "u-backfill" } });
    expect(sub?.source).toBe("MANUAL");
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.plan).toBe("solo");
    expect(sub?.trialEndsAt).toBeNull();
    expect(sub?.graceUntil).toBeNull();
    expect(sub?.notes).toContain("pre-billing");

    expect(await canWriteInWorkspace(workspaceId)).toBe(true);
  });

  it("dimensiona o plano pela quantidade de workspaces que a pessoa ja possui", async () => {
    await ownerWithWorkspaces("u-um", "um@example.com", 1);
    await ownerWithWorkspaces("u-tres", "tres@example.com", 3);
    await ownerWithWorkspaces("u-seis", "seis@example.com", 6);

    await runBackfill();

    const subs = await testDb.subscription.findMany();
    const planByUser = Object.fromEntries(subs.map((s) => [s.userId, s.plan]));

    expect(planByUser["u-um"]).toBe("solo");
    expect(planByUser["u-tres"]).toBe("team");
    expect(planByUser["u-seis"]).toBe("unlimited");
  });

  it("libera todos os workspaces de quem tinha mais de um", async () => {
    const ids = await ownerWithWorkspaces("u-varios", "varios@example.com", 3);

    await runBackfill();

    for (const id of ids) {
      expect(await canWriteInWorkspace(id)).toBe(true);
    }
  });

  it("nao cria assinatura para quem so participa como member", async () => {
    await ownerWithWorkspaces("u-dono", "dono@example.com", 1);
    const convidada = await testDb.user.create({
      data: { id: "u-convidada", name: "Convidada", email: "convidada@example.com" },
    });
    const ws = await testDb.workspace.findFirstOrThrow();
    await testDb.member.create({
      data: { userId: convidada.id, workspaceId: ws.id, role: "MEMBER" },
    });

    await runBackfill();

    const sub = await testDb.subscription.findUnique({ where: { userId: convidada.id } });
    expect(sub).toBeNull();
  });

  it("e idempotente e nao toca em quem ja tem assinatura", async () => {
    await ownerWithWorkspaces("u-existente", "existente@example.com", 2);
    await testDb.subscription.create({
      data: {
        userId: "u-existente",
        plan: "solo",
        source: "ASAAS",
        status: "TRIALING",
      },
    });

    await runBackfill();
    await runBackfill();

    const subs = await testDb.subscription.findMany({ where: { userId: "u-existente" } });
    expect(subs).toHaveLength(1);
    expect(subs[0].source).toBe("ASAAS");
    expect(subs[0].status).toBe("TRIALING");
    expect(subs[0].plan).toBe("solo");
  });

  it("rodar duas vezes nao duplica a assinatura criada pelo proprio backfill", async () => {
    await ownerWithWorkspaces("u-duplo", "duplo@example.com", 1);

    await runBackfill();
    await runBackfill();

    const subs = await testDb.subscription.findMany({ where: { userId: "u-duplo" } });
    expect(subs).toHaveLength(1);
  });
});
