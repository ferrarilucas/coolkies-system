import type { Subscription } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { hasPaidAccess, isPeriodPaid } from "@/lib/period";
import { effectiveLimit } from "@/lib/plans";
import { resetDb, testDb } from "@/test/db";
import { applyInterPixEvent } from "./interpix-events";
import {
  activeWorkspaceIds,
  canWriteInWorkspace,
  ensureTrialSubscription,
  isSubscriptionUsable,
  recordInterPixSubscription,
} from "./subscription";

function buildSubscription(overrides: Partial<Subscription>): Subscription {
  return {
    id: "sub-test",
    userId: "user-test",
    plan: "corre",
    status: "TRIALING",
    provider: "INTERPIX",
    cycle: "MONTHLY",
    interpixSubscriptionId: null,
    interpixPixCopyPaste: null,
    lastAppliedEventId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeSyncedAt: null,
    cardBrand: null,
    cardLast4: null,
    trialEndsAt: null,
    graceUntil: null,
    graceGrantedAt: null,
    authorizedAt: null,
    currentPeriodEnd: null,
    pendingCycleSeq: null,
    pendingChargeDueAt: null,
    lastFailureReason: null,
    lastPaidAt: null,
    paidThroughAt: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("model de assinatura", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria assinatura ligada ao usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-sub", name: "Ana", email: "ana@example.com" },
    });

    const sub = await testDb.subscription.create({
      data: { userId: user.id, plan: "corre" },
    });

    expect(sub.status).toBe("TRIALING");
  });

  it("permite no máximo uma assinatura por usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-dup", name: "Bia", email: "bia@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "corre" },
    });

    await expect(
      testDb.subscription.create({
        data: { userId: user.id, plan: "cresce" },
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
      data: { userId: user.id, plan, status: "ACTIVE" },
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
    const { user, ids } = await ownerWith("corre", 3);
    const active = await activeWorkspaceIds(user.id);

    expect(active.has(ids[0])).toBe(true);
    expect(active.has(ids[1])).toBe(false);
    expect(active.has(ids[2])).toBe(false);
  });

  it("plano team ativa os quatro primeiros", async () => {
    const { user, ids } = await ownerWith("cresce", 5);
    const active = await activeWorkspaceIds(user.id);

    expect(active.size).toBe(4);
    expect(active.has(ids[4])).toBe(false);
  });

  it("plano unlimited ativa todos", async () => {
    const { user, ids } = await ownerWith("escala", 7);
    const active = await activeWorkspaceIds(user.id);

    expect(active.size).toBe(ids.length);
  });

  it("empate de createdAt resolve sempre no mesmo workspace", async () => {
    const user = await testDb.user.create({
      data: { id: "u-empate", name: "Dona", email: "empate@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "corre", status: "ACTIVE" },
    });

    const mesmoInstante = new Date("2026-08-01T12:00:00Z");
    const ids = ["ws-empate-c", "ws-empate-a", "ws-empate-b"];
    for (const id of ids) {
      await testDb.workspace.create({
        data: { id, name: id, slug: id },
      });
      await testDb.member.create({
        data: {
          userId: user.id,
          workspaceId: id,
          role: "OWNER",
          createdAt: mesmoInstante,
        },
      });
    }

    const menorId = [...ids].sort()[0];

    for (let i = 0; i < 5; i += 1) {
      const active = await activeWorkspaceIds(user.id);
      expect(active.size).toBe(1);
      expect(active.has(menorId)).toBe(true);
    }
  });

  it("ser member nao consome cota do proprio plano", async () => {
    const user = await testDb.user.create({
      data: { id: "u-member-nao-consome", name: "Dono", email: "membernaoconsome@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "corre", status: "ACTIVE" },
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
  const now = new Date("2026-09-20T12:00:00Z");

  it("ACTIVE vale", () => {
    expect(isSubscriptionUsable(buildSubscription({ status: "ACTIVE" }), now)).toBe(true);
  });

  it("PAST_DUE com pagamento alguma vez vale — está em dunning e ainda pode pagar", () => {
    const sub = buildSubscription({ status: "PAST_DUE", lastPaidAt: new Date("2026-08-20") });
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("PAST_DUE sem pagamento comprovado não vale", () => {
    const sub = buildSubscription({ status: "PAST_DUE", lastPaidAt: null });
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("PAST_DUE não exige o período em aberto coberto — o status já significa período não pago", () => {
    const sub = buildSubscription({
      status: "PAST_DUE",
      lastPaidAt: new Date("2026-01-10"),
      paidThroughAt: new Date("2026-02-10"),
      currentPeriodEnd: new Date("2026-09-30"),
    });
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("PENDING_AUTH vale enquanto a carência da autorização durar", () => {
    const sub = buildSubscription({ status: "PENDING_AUTH", graceUntil: new Date("2026-09-27") });
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("PENDING_AUTH sem carência não vale — autorizar não é pagar", () => {
    const sub = buildSubscription({ status: "PENDING_AUTH", graceUntil: null });
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("PENDING_AUTH com carência vencida não vale", () => {
    const sub = buildSubscription({ status: "PENDING_AUTH", graceUntil: new Date("2026-09-10") });
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("PENDING_AUTH sem carência mas com trial ainda vigente vale — contratar durante o teste não pode derrubar o acesso", () => {
    const sub = buildSubscription({
      status: "PENDING_AUTH",
      graceUntil: null,
      trialEndsAt: new Date("2026-09-30"),
    });
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("PENDING_AUTH com trial já vencido e sem carência não vale", () => {
    const sub = buildSubscription({
      status: "PENDING_AUTH",
      graceUntil: null,
      trialEndsAt: new Date("2026-09-01"),
    });
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("SUSPENDED e AUTH_DENIED não valem", () => {
    expect(isSubscriptionUsable(buildSubscription({ status: "SUSPENDED" }), now)).toBe(false);
    expect(isSubscriptionUsable(buildSubscription({ status: "AUTH_DENIED" }), now)).toBe(false);
  });

  it("CANCELED com período coberto pelo pagamento continua utilizável até o fim do período pago", () => {
    const sub = buildSubscription({
      status: "CANCELED",
      paidThroughAt: new Date("2026-09-30"),
      currentPeriodEnd: new Date("2026-09-30"),
    });
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("CANCELED com período coberto pelo pagamento deixa de valer depois do fim do período pago", () => {
    const sub = buildSubscription({
      status: "CANCELED",
      paidThroughAt: new Date("2026-09-10"),
      currentPeriodEnd: new Date("2026-09-10"),
    });
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("CANCELED sem período pago registrado não vale", () => {
    const sub = buildSubscription({
      status: "CANCELED",
      paidThroughAt: new Date("2026-09-01"),
      currentPeriodEnd: null,
    });
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("CANCELED sem pagamento comprovado não dá acesso, mesmo com período em aberto", () => {
    const sub = buildSubscription({
      status: "CANCELED",
      paidThroughAt: null,
      currentPeriodEnd: new Date("2026-09-30"),
    });
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("CANCELED cujo período em aberto não é coberto pelo último pagamento não dá acesso — recontratação avançou o vencimento sem novo pagamento", () => {
    const sub = buildSubscription({
      status: "CANCELED",
      cycle: "MONTHLY",
      paidThroughAt: new Date("2026-08-15"),
      currentPeriodEnd: new Date("2026-09-30"),
    });
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("CANCELED cujo período em aberto é coberto pelo último pagamento dá acesso até o fim dele", () => {
    const sub = buildSubscription({
      status: "CANCELED",
      cycle: "YEARLY",
      paidThroughAt: new Date("2026-09-30"),
      currentPeriodEnd: new Date("2026-09-30"),
    });
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("TRIALING vale dentro do prazo", () => {
    const sub = buildSubscription({ status: "TRIALING", trialEndsAt: new Date("2026-09-30") });
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("TRIALING vencido não vale", () => {
    const sub = buildSubscription({ status: "TRIALING", trialEndsAt: new Date("2026-09-01") });
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("sem assinatura não vale", () => {
    expect(isSubscriptionUsable(null, now)).toBe(false);
  });
});

describe("acesso e limite concordam sobre quem pagou, por status", () => {
  const now = new Date("2026-09-20T12:00:00Z");

  it("PAST_DUE: pagamento alguma vez basta tanto para o acesso quanto para o limite cheio", () => {
    const sub = buildSubscription({
      status: "PAST_DUE",
      lastPaidAt: new Date("2026-01-10"),
      paidThroughAt: null,
      currentPeriodEnd: new Date("2026-09-01"),
    });

    expect(isSubscriptionUsable(sub, now)).toBe(true);
    expect(hasPaidAccess(sub)).toBe(true);
    expect(effectiveLimit("cresce", sub.status, hasPaidAccess(sub))).toBe(4);
  });

  it("PAST_DUE: nunca ter pago corta tanto o acesso quanto o limite", () => {
    const sub = buildSubscription({ status: "PAST_DUE", lastPaidAt: null });

    expect(isSubscriptionUsable(sub, now)).toBe(false);
    expect(hasPaidAccess(sub)).toBe(false);
    expect(effectiveLimit("cresce", sub.status, hasPaidAccess(sub))).toBe(1);
  });

  it("CANCELED: período coberto pelo pagamento dá acesso e limite cheio", () => {
    const sub = buildSubscription({
      status: "CANCELED",
      paidThroughAt: new Date("2026-09-30"),
      currentPeriodEnd: new Date("2026-09-30"),
    });

    expect(isSubscriptionUsable(sub, now)).toBe(true);
    expect(hasPaidAccess(sub)).toBe(true);
    expect(effectiveLimit("cresce", sub.status, hasPaidAccess(sub))).toBe(4);
  });

  it("CANCELED: período não coberto corta tanto o acesso quanto o limite, mesmo tendo pago antes", () => {
    const sub = buildSubscription({
      status: "CANCELED",
      paidThroughAt: new Date("2026-08-01"),
      currentPeriodEnd: new Date("2026-09-30"),
    });

    expect(isSubscriptionUsable(sub, now)).toBe(false);
    expect(hasPaidAccess(sub)).toBe(false);
    expect(effectiveLimit("cresce", sub.status, hasPaidAccess(sub))).toBe(1);
  });
});

describe("permissao de escrita", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("workspace excedente fica somente leitura", async () => {
    const user = await testDb.user.create({
      data: { id: "u-write", name: "Dono", email: "write@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "corre", status: "ACTIVE" },
    });

    const primeiro = await testDb.workspace.create({
      data: { name: "Primeiro", slug: "primeiro-write" },
    });
    const segundo = await testDb.workspace.create({
      data: { name: "Segundo", slug: "segundo-write" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: primeiro.id, role: "OWNER" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: segundo.id, role: "OWNER" },
    });

    expect(await canWriteInWorkspace(primeiro.id)).toBe(true);
    expect(await canWriteInWorkspace(segundo.id)).toBe(false);
  });

  it("workspace sem owner com assinatura utilizavel fica somente leitura", async () => {
    const user = await testDb.user.create({
      data: { id: "u-nosub", name: "Sem plano", email: "nosub@example.com" },
    });
    const ws = await testDb.workspace.create({
      data: { name: "Sem plano", slug: "sem-plano" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
    });

    expect(await canWriteInWorkspace(ws.id)).toBe(false);
  });
});

describe("recordInterPixSubscription", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria assinatura nova em PENDING_AUTH com os dados do gateway", async () => {
    const user = await testDb.user.create({
      data: { id: "u-interpix-new", name: "Cris", email: "cris@example.com" },
    });
    const vencimento = new Date("2026-10-01T00:00:00Z");

    await recordInterPixSubscription({
      userId: user.id,
      plan: "cresce",
      cycle: "MONTHLY",
      interpixSubscriptionId: "ip_sub_1",
      pixCopyPaste: "00020101...copiaecola",
      nextDueDate: vencimento,
    });

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).toBe("PENDING_AUTH");
    expect(sub?.plan).toBe("cresce");
    expect(sub?.cycle).toBe("MONTHLY");
    expect(sub?.interpixSubscriptionId).toBe("ip_sub_1");
    expect(sub?.interpixPixCopyPaste).toBe("00020101...copiaecola");
    expect(sub?.currentPeriodEnd?.toISOString()).toBe(vencimento.toISOString());
  });

  it("atualiza quem nao esta ativo para PENDING_AUTH e zera a carencia anterior", async () => {
    const user = await testDb.user.create({
      data: { id: "u-interpix-suspended", name: "Davi", email: "davi@example.com" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        status: "SUSPENDED",
        graceUntil: new Date("2026-09-01T00:00:00Z"),
      },
    });
    const vencimento = new Date("2026-10-01T00:00:00Z");

    await recordInterPixSubscription({
      userId: user.id,
      plan: "cresce",
      cycle: "YEARLY",
      interpixSubscriptionId: "ip_sub_2",
      pixCopyPaste: null,
      nextDueDate: vencimento,
    });

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).toBe("PENDING_AUTH");
    expect(sub?.graceUntil).toBeNull();
    expect(sub?.plan).toBe("cresce");
    expect(sub?.cycle).toBe("YEARLY");
    expect(sub?.interpixSubscriptionId).toBe("ip_sub_2");
  });

  it("atualiza quem esta ativo mantendo ACTIVE e o acesso", async () => {
    const user = await testDb.user.create({
      data: { id: "u-interpix-active", name: "Elis", email: "elis@example.com" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        status: "ACTIVE",
        interpixSubscriptionId: "ip_sub_antiga",
      },
    });
    const vencimento = new Date("2026-10-01T00:00:00Z");

    await recordInterPixSubscription({
      userId: user.id,
      plan: "cresce",
      cycle: "MONTHLY",
      interpixSubscriptionId: "ip_sub_nova",
      pixCopyPaste: "00020101...novo",
      nextDueDate: vencimento,
    });

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.plan).toBe("cresce");
    expect(sub?.cycle).toBe("MONTHLY");
    expect(sub?.interpixSubscriptionId).toBe("ip_sub_nova");
    expect(isSubscriptionUsable(sub, new Date())).toBe(true);
    expect(sub?.authorizedAt).toBeNull();
  });

  it("contratar durante o trial vigente preserva o trialEndsAt e continua utilizável", async () => {
    const user = await testDb.user.create({
      data: { id: "u-interpix-during-trial", name: "Helo", email: "helo@example.com" },
    });
    await ensureTrialSubscription(user.id);
    const trialAntes = await testDb.subscription.findUnique({ where: { userId: user.id } });

    await recordInterPixSubscription({
      userId: user.id,
      plan: "cresce",
      cycle: "MONTHLY",
      interpixSubscriptionId: "ip_sub_during_trial",
      pixCopyPaste: "00020101...trial",
      nextDueDate: new Date("2026-10-01T00:00:00Z"),
    });

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).toBe("PENDING_AUTH");
    expect(sub?.trialEndsAt?.toISOString()).toBe(trialAntes?.trialEndsAt?.toISOString());
    expect(isSubscriptionUsable(sub, new Date())).toBe(true);
  });

  it("recontratar preserva o lastPaidAt — a evidência de pagamento não é apagada por uma nova contratação", async () => {
    const user = await testDb.user.create({
      data: { id: "u-interpix-keeps-paid-at", name: "Rita", email: "rita@example.com" },
    });
    const pagoEm = new Date("2026-08-15T00:00:00Z");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        status: "CANCELED",
        interpixSubscriptionId: "ip_sub_cancelada",
        lastPaidAt: pagoEm,
        currentPeriodEnd: new Date("2026-08-20T00:00:00Z"),
      },
    });

    await recordInterPixSubscription({
      userId: user.id,
      plan: "cresce",
      cycle: "MONTHLY",
      interpixSubscriptionId: "ip_sub_recontratada",
      pixCopyPaste: "00020101...recontratada",
      nextDueDate: new Date("2026-10-01T00:00:00Z"),
    });

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.lastPaidAt?.toISOString()).toBe(pagoEm.toISOString());
  });

  it("recontratar escreve um fim de período novo sem tocar paidThroughAt — o novo período não fica coberto", async () => {
    const user = await testDb.user.create({
      data: { id: "u-interpix-recontrata-sem-cobertura", name: "Sara", email: "sara@example.com" },
    });
    const cobertoAte = new Date("2026-08-20T00:00:00Z");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        status: "CANCELED",
        interpixSubscriptionId: "ip_sub_cancelada_2",
        lastPaidAt: new Date("2026-08-15T00:00:00Z"),
        paidThroughAt: cobertoAte,
        currentPeriodEnd: cobertoAte,
      },
    });

    await recordInterPixSubscription({
      userId: user.id,
      plan: "cresce",
      cycle: "MONTHLY",
      interpixSubscriptionId: "ip_sub_recontratada_2",
      pixCopyPaste: "00020101...recontratada2",
      nextDueDate: new Date("2026-10-01T00:00:00Z"),
    });

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.paidThroughAt?.toISOString()).toBe(cobertoAte.toISOString());
    expect(sub?.currentPeriodEnd?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(sub && isPeriodPaid(sub)).toBe(false);
  });

  it("nunca limpa graceGrantedAt — é a invariante que impede reabrir o laço de carência reciclável", async () => {
    const user = await testDb.user.create({
      data: { id: "u-interpix-grant-kept", name: "Fabi", email: "fabi@example.com" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        status: "SUSPENDED",
        graceUntil: new Date("2026-09-01T00:00:00Z"),
        graceGrantedAt: new Date("2025-06-01T00:00:00Z"),
      },
    });

    await recordInterPixSubscription({
      userId: user.id,
      plan: "cresce",
      cycle: "YEARLY",
      interpixSubscriptionId: "ip_sub_grant_kept",
      pixCopyPaste: null,
      nextDueDate: new Date("2026-10-01T00:00:00Z"),
    });

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.graceUntil).toBeNull();
    expect(sub?.graceGrantedAt?.toISOString()).toBe("2025-06-01T00:00:00.000Z");
  });

  it("registrar um mandato novo zera o instante de autorização do mandato anterior", async () => {
    const user = await testDb.user.create({
      data: { id: "u-interpix-authorized-reset", name: "Ivo", email: "ivo@example.com" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        status: "SUSPENDED",
        authorizedAt: new Date("2026-08-01T00:00:00Z"),
      },
    });

    await recordInterPixSubscription({
      userId: user.id,
      plan: "corre",
      cycle: "MONTHLY",
      interpixSubscriptionId: "ip_sub_authorized_reset",
      pixCopyPaste: "00020101...novomandato",
      nextDueDate: new Date("2026-10-01T00:00:00Z"),
    });

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.authorizedAt).toBeNull();
  });

  it("ciclo completo: autorizar, carência vencer, recontratar, autorizar de novo — carência continua nula", async () => {
    const user = await testDb.user.create({
      data: { id: "u-full-cycle", name: "Guga", email: "guga@example.com" },
    });
    await ensureTrialSubscription(user.id);

    await recordInterPixSubscription({
      userId: user.id,
      plan: "corre",
      cycle: "MONTHLY",
      interpixSubscriptionId: "ip_full_cycle",
      pixCopyPaste: "00020101...primeira",
      nextDueDate: new Date("2026-09-20T00:00:00Z"),
    });

    const firstAuth = await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "1",
      data: { subscriptionId: "ip_full_cycle", externalUserId: user.id },
    });
    expect(firstAuth).toBe("applied");

    const afterFirstAuth = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(afterFirstAuth?.graceGrantedAt).not.toBeNull();
    expect(afterFirstAuth?.graceUntil).not.toBeNull();
    expect(afterFirstAuth?.authorizedAt).not.toBeNull();

    await applyInterPixEvent({
      type: "subscription.suspended",
      eventId: "2",
      data: { subscriptionId: "ip_full_cycle", externalUserId: user.id },
    });

    await recordInterPixSubscription({
      userId: user.id,
      plan: "corre",
      cycle: "MONTHLY",
      interpixSubscriptionId: "ip_full_cycle_2",
      pixCopyPaste: "00020101...segunda",
      nextDueDate: new Date("2026-11-20T00:00:00Z"),
    });

    const afterRecontratacao = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(afterRecontratacao?.status).toBe("PENDING_AUTH");
    expect(afterRecontratacao?.graceGrantedAt).not.toBeNull();
    expect(afterRecontratacao?.authorizedAt).toBeNull();

    const secondAuth = await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "3",
      data: { subscriptionId: "ip_full_cycle_2", externalUserId: user.id },
    });
    expect(secondAuth).toBe("applied");

    const finalSub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(finalSub?.graceUntil).toBeNull();
  });
});

describe("trial na criacao do primeiro workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria assinatura em trial de 14 dias", async () => {
    const user = await testDb.user.create({
      data: { id: "u-trial", name: "Nova", email: "trial@example.com" },
    });

    await ensureTrialSubscription(user.id);
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });

    expect(sub?.status).toBe("TRIALING");
    expect(sub?.plan).toBe("corre");
    const dias = Math.round(
      ((sub?.trialEndsAt?.getTime() ?? 0) - Date.now()) / 86400000,
    );
    expect(dias).toBe(14);
  });

  it("nao renova o trial de quem ja tem assinatura", async () => {
    const user = await testDb.user.create({
      data: { id: "u-retrial", name: "Velha", email: "retrial@example.com" },
    });
    const antiga = new Date("2026-01-01");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        trialEndsAt: antiga,
      },
    });

    await ensureTrialSubscription(user.id);
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });

    expect(sub?.trialEndsAt?.toISOString()).toBe(antiga.toISOString());
  });
});
