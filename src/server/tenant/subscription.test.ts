import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { activeWorkspaceIds, isSubscriptionUsable } from "./subscription";

describe("model de assinatura", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria assinatura ligada ao usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-sub", name: "Ana", email: "ana@example.com" },
    });

    const sub = await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL" },
    });

    expect(sub.status).toBe("TRIALING");
    expect(sub.asaasSubscriptionId).toBeNull();
  });

  it("permite no máximo uma assinatura por usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-dup", name: "Bia", email: "bia@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL" },
    });

    await expect(
      testDb.subscription.create({
        data: { userId: user.id, plan: "team", source: "MANUAL" },
      }),
    ).rejects.toThrow();
  });
});

describe("workspaces ativos por plano", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function ownerWith(plan: string, count: number) {
    const user = await testDb.user.create({
      data: { id: `u-${plan}-${count}`, name: "Dono", email: `${plan}${count}@example.com` },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan, source: "MANUAL", status: "ACTIVE" },
    });

    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const ws = await testDb.workspace.create({
        data: { name: `WS ${i}`, slug: `${plan}-${count}-${i}` },
      });
      await testDb.member.create({
        data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
      });
      ids.push(ws.id);
    }
    return { user, ids };
  }

  it("plano solo com tres workspaces ativa so o mais antigo", async () => {
    const { user, ids } = await ownerWith("solo", 3);
    const active = await activeWorkspaceIds(user.id);

    expect(active.has(ids[0])).toBe(true);
    expect(active.has(ids[1])).toBe(false);
    expect(active.has(ids[2])).toBe(false);
  });

  it("plano team ativa os quatro primeiros", async () => {
    const { user, ids } = await ownerWith("team", 5);
    const active = await activeWorkspaceIds(user.id);

    expect(active.size).toBe(4);
    expect(active.has(ids[4])).toBe(false);
  });

  it("plano unlimited ativa todos", async () => {
    const { user, ids } = await ownerWith("unlimited", 7);
    const active = await activeWorkspaceIds(user.id);

    expect(active.size).toBe(ids.length);
  });

  it("ser member nao consome cota do proprio plano", async () => {
    const user = await testDb.user.create({
      data: { id: "u-member-nao-consome", name: "Dono", email: "membernaoconsome@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL", status: "ACTIVE" },
    });

    const alheio = await testDb.workspace.create({
      data: { name: "Alheio", slug: "alheio-cota" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: alheio.id, role: "MEMBER" },
    });

    const proprio = await testDb.workspace.create({
      data: { name: "Proprio", slug: "proprio-cota" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: proprio.id, role: "OWNER" },
    });

    const active = await activeWorkspaceIds(user.id);
    expect(active.has(proprio.id)).toBe(true);
    expect(active.has(alheio.id)).toBe(false);
  });
});

describe("assinatura utilizavel", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("ACTIVE vale", () => {
    expect(isSubscriptionUsable({ status: "ACTIVE" } as never, now)).toBe(true);
  });

  it("TRIALING dentro do prazo vale", () => {
    const sub = { status: "TRIALING", trialEndsAt: new Date("2026-09-10") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("TRIALING vencido nao vale", () => {
    const sub = { status: "TRIALING", trialEndsAt: new Date("2026-08-20") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("PAST_DUE dentro da tolerancia vale", () => {
    const sub = { status: "PAST_DUE", graceUntil: new Date("2026-09-05") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("PAST_DUE com tolerancia vencida nao vale", () => {
    const sub = { status: "PAST_DUE", graceUntil: new Date("2026-08-25") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("sem assinatura nao vale", () => {
    expect(isSubscriptionUsable(null, now)).toBe(false);
  });
});
