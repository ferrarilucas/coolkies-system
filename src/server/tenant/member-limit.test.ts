import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { createInvite, joinWithCode } = await import("./workspaces");

async function seedUserWithSession(id: string, email: string) {
  const user = await testDb.user.create({ data: { id, name: "Usuária", email } });
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

describe("limite de usuários por workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("corre aceita o segundo convite e recusa o terceiro", async () => {
    const owner = await seedUserWithSession("u-owner", "owner@example.com");
    await testDb.subscription.create({
      data: { userId: owner.id, plan: "corre", status: "ACTIVE" },
    });
    const ws = await testDb.workspace.create({ data: { name: "WS", slug: "ws-corre-limit" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });

    await createInvite(ws.id, "MEMBER", null);

    await expect(createInvite(ws.id, "MEMBER", null)).rejects.toThrow(
      "Seu plano atingiu o limite de usuários deste workspace. Cancele um convite pendente ou faça upgrade para convidar mais gente.",
    );

    expect(await testDb.invitation.count({ where: { workspaceId: ws.id } })).toBe(1);
  });

  it("recusa entrar quando o workspace já está no limite de usuários", async () => {
    const owner = await seedUserWithSession("u-owner2", "owner2@example.com");
    await testDb.subscription.create({
      data: { userId: owner.id, plan: "corre", status: "ACTIVE" },
    });
    const ws = await testDb.workspace.create({ data: { name: "WS2", slug: "ws-corre-limit-2" } });
    await testDb.member.create({ data: { userId: owner.id, workspaceId: ws.id, role: "OWNER" } });

    const segunda = await testDb.user.create({
      data: { id: "u-segunda", name: "Segunda", email: "segunda@example.com" },
    });
    await testDb.member.create({ data: { userId: segunda.id, workspaceId: ws.id, role: "MEMBER" } });

    const invite = await testDb.invitation.create({
      data: {
        code: "ABCD1234",
        workspaceId: ws.id,
        role: "MEMBER",
        inviterId: owner.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await seedUserWithSession("u-terceira", "terceira@example.com");
    const result = await joinWithCode(invite.code);

    expect(result).toEqual({
      ok: false,
      error: "Este workspace já atingiu o limite de usuários do plano.",
    });
    expect(await testDb.member.count({ where: { workspaceId: ws.id } })).toBe(2);
  });
});
