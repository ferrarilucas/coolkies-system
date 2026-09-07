import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { applyInterPixEvent } from "./interpix-events";

const GRACE_DAYS = 7;

async function assinante(id: string, overrides: Record<string, unknown> = {}) {
  const user = await testDb.user.create({
    data: { id, name: "Dono", email: `${id}@example.com` },
  });
  await testDb.subscription.create({
    data: {
      userId: user.id,
      plan: "corre",
      provider: "INTERPIX",
      status: "PENDING_AUTH",
      interpixSubscriptionId: `ipx-${id}`,
      currentPeriodEnd: new Date("2026-09-20T00:00:00Z"),
      ...overrides,
    },
  });
  return user;
}

function subOf(userId: string) {
  return testDb.subscription.findUnique({ where: { userId } });
}

describe("eventos da InterPix", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cycle.paid ativa o plano e limpa a carência", async () => {
    const user = await assinante("u-paid", { graceUntil: new Date("2026-09-27T00:00:00Z") });

    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "10",
      data: { subscriptionId: "ipx-u-paid", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("applied");
    const sub = await subOf(user.id);
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.graceUntil).toBeNull();
  });

  it("subscription.authorized NÃO ativa o plano — autorização não é pagamento", async () => {
    const user = await assinante("u-auth");

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "11",
      data: { subscriptionId: "ipx-u-auth", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    expect(sub?.status).not.toBe("ACTIVE");
  });

  it("subscription.authorized estende a carência até o vencimento mais sete dias", async () => {
    const user = await assinante("u-grace");

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "12",
      data: { subscriptionId: "ipx-u-grace", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    const esperado = new Date("2026-09-20T00:00:00Z");
    esperado.setDate(esperado.getDate() + GRACE_DAYS);
    expect(sub?.graceUntil?.toISOString()).toBe(esperado.toISOString());
  });

  it("cycle.failed mantém o acesso — dunning não é corte", async () => {
    const user = await assinante("u-failed", { status: "ACTIVE" });

    await applyInterPixEvent({
      type: "cycle.failed",
      eventId: "13",
      data: { subscriptionId: "ipx-u-failed", cycleSeq: 2, reason: "saldo insuficiente" },
    });

    const sub = await subOf(user.id);
    expect(sub?.status).toBe("ACTIVE");
  });

  it("subscription.suspended corta o acesso", async () => {
    const user = await assinante("u-susp", { status: "PAST_DUE" });

    await applyInterPixEvent({
      type: "subscription.suspended",
      eventId: "14",
      data: { subscriptionId: "ipx-u-susp", externalUserId: user.id },
    });

    expect((await subOf(user.id))?.status).toBe("SUSPENDED");
  });

  it("evento repetido não reaplica", async () => {
    const user = await assinante("u-dup");
    const evento = {
      type: "cycle.paid" as const,
      eventId: "20",
      data: { subscriptionId: "ipx-u-dup", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    };

    expect(await applyInterPixEvent(evento)).toBe("applied");
    expect(await applyInterPixEvent(evento)).toBe("duplicate");
    expect((await subOf(user.id))?.lastAppliedEventId).toBe(20n);
  });

  it("evento atrasado não reativa quem já cancelou", async () => {
    const user = await assinante("u-stale");

    await applyInterPixEvent({
      type: "subscription.canceled",
      eventId: "30",
      data: { subscriptionId: "ipx-u-stale", externalUserId: user.id, pendingCycleSeq: null },
    });

    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "29",
      data: { subscriptionId: "ipx-u-stale", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("stale");
    expect((await subOf(user.id))?.status).toBe("CANCELED");
  });

  it("compara eventId como número: 1000 é mais novo que 999", async () => {
    const user = await assinante("u-bigint");

    await applyInterPixEvent({
      type: "subscription.past_due",
      eventId: "999",
      data: { subscriptionId: "ipx-u-bigint", externalUserId: user.id, retryDate: "2026-09-25" },
    });

    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "1000",
      data: { subscriptionId: "ipx-u-bigint", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("applied");
    expect((await subOf(user.id))?.status).toBe("ACTIVE");
  });

  it("assinatura desconhecida não quebra e não cria nada", async () => {
    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "40",
      data: { subscriptionId: "ipx-nao-existe", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("unknown");
    expect(await testDb.subscription.count()).toBe(0);
  });
});
