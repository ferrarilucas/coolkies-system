import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { createWorkspaceForUser } = await import("./workspaces");

async function seedUserWithSession(id: string, email: string) {
  const user = await testDb.user.create({ data: { id, name: "Dono", email } });
  const session = await testDb.session.create({
    data: {
      id: `s-${id}`,
      token: `tok-${id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  sessionResult = { user: { id: user.id }, session: { id: session.id } };
  return user;
}

describe("createWorkspaceForUser", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria o trial de 14 dias junto com o primeiro workspace", async () => {
    await seedUserWithSession("u-first", "first@example.com");

    const id = await createWorkspaceForUser("Minha Empresa");

    const sub = await testDb.subscription.findUnique({ where: { userId: "u-first" } });
    expect(sub?.status).toBe("TRIALING");
    expect(sub?.plan).toBe("solo");

    const ws = await testDb.workspace.findUnique({ where: { id } });
    expect(ws).not.toBeNull();

    const membership = await testDb.member.findFirst({
      where: { userId: "u-first", workspaceId: id },
    });
    expect(membership?.role).toBe("OWNER");
  });

  it("recusa o segundo workspace durante o trial e nao grava nada", async () => {
    await seedUserWithSession("u-second", "second@example.com");
    await createWorkspaceForUser("Primeiro");

    expect(await testDb.workspace.count()).toBe(1);
    expect(await testDb.member.count()).toBe(1);

    await expect(createWorkspaceForUser("Segundo")).rejects.toThrow(
      "Durante o teste você pode ter um workspace. Assine um plano para criar outro.",
    );

    expect(await testDb.workspace.count()).toBe(1);
    expect(await testDb.member.count()).toBe(1);
  });

  it("recusa workspace acima do limite fora do trial com mensagem de upgrade", async () => {
    const user = await seedUserWithSession("u-active", "active@example.com");
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL", status: "ACTIVE" },
    });
    const ws = await testDb.workspace.create({ data: { name: "WS", slug: "ws-active-limit" } });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
    });

    await expect(createWorkspaceForUser("Outro")).rejects.toThrow(
      "Seu plano não permite mais workspaces. Faça upgrade para criar outro.",
    );

    expect(await testDb.workspace.count()).toBe(1);
    expect(await testDb.member.count()).toBe(1);
  });

  it("nao renova o trial de quem ja tem assinatura ao criar workspace", async () => {
    const user = await seedUserWithSession("u-existing-trial", "existing@example.com");
    const antiga = new Date("2026-01-01");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "solo",
        source: "MANUAL",
        status: "TRIALING",
        trialEndsAt: antiga,
      },
    });

    await createWorkspaceForUser("Primeiro");

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.trialEndsAt?.toISOString()).toBe(antiga.toISOString());
  });
});
