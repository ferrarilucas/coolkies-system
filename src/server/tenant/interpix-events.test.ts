import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { applyInterPixEvent } from "./interpix-events";

async function subscriber(id: string, overrides: Record<string, unknown> = {}) {
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
    const user = await subscriber("u-paid", { graceUntil: new Date("2026-09-27T00:00:00Z") });

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

  it("cycle.paid grava o instante do pagamento — é a evidência que sustenta o acesso depois de CANCELED/PAST_DUE", async () => {
    const user = await subscriber("u-paid-evidence");

    await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "17",
      data: { subscriptionId: "ipx-u-paid-evidence", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    const sub = await subOf(user.id);
    expect(sub?.lastPaidAt?.toISOString()).toBe("2026-09-19T09:00:00.000Z");
  });

  it("cycle.paid limpa o motivo da última falha — atraso futuro não deve exibir motivo de tentativa antiga", async () => {
    const user = await subscriber("u-paid-clears-reason", {
      lastFailureReason: "saldo insuficiente",
    });

    await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "18",
      data: { subscriptionId: "ipx-u-paid-clears-reason", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    const sub = await subOf(user.id);
    expect(sub?.lastFailureReason).toBeNull();
  });

  it("cycle.paid limpa graceGrantedAt — quem paga de verdade recupera o direito à ponte no futuro", async () => {
    const user = await subscriber("u-paid-grants", {
      graceUntil: new Date("2026-09-27T00:00:00Z"),
      graceGrantedAt: new Date("2025-01-01T00:00:00Z"),
    });

    await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "15",
      data: { subscriptionId: "ipx-u-paid-grants", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    const sub = await subOf(user.id);
    expect(sub?.graceGrantedAt).toBeNull();
  });

  it("sem pagamento, graceGrantedAt continua consumido — a carência não se recicla de graça", async () => {
    const user = await subscriber("u-no-paid-grants", {
      status: "SUSPENDED",
      graceGrantedAt: new Date("2025-01-01T00:00:00Z"),
    });

    await applyInterPixEvent({
      type: "subscription.past_due",
      eventId: "16",
      data: { subscriptionId: "ipx-u-no-paid-grants", externalUserId: user.id, retryDate: "2026-09-25" },
    });

    const sub = await subOf(user.id);
    expect(sub?.graceGrantedAt?.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("cycle.paid avança o vencimento em um mês no ciclo mensal", async () => {
    const user = await subscriber("u-period-monthly", { cycle: "MONTHLY" });

    await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "50",
      data: { subscriptionId: "ipx-u-period-monthly", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    const sub = await subOf(user.id);
    expect(sub?.currentPeriodEnd?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });

  it("cycle.paid avança o vencimento em um ano no ciclo anual", async () => {
    const user = await subscriber("u-period-yearly", { cycle: "YEARLY" });

    await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "51",
      data: { subscriptionId: "ipx-u-period-yearly", cycleSeq: 1, amount: "345.00", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    const sub = await subOf(user.id);
    expect(sub?.currentPeriodEnd?.toISOString()).toBe("2027-09-20T00:00:00.000Z");
  });

  it("subscription.authorized NÃO ativa o plano — autorização não é pagamento", async () => {
    const user = await subscriber("u-auth");

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "11",
      data: { subscriptionId: "ipx-u-auth", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    expect(sub?.status).toBe("PENDING_AUTH");
  });

  it("subscription.authorized sempre grava o instante da autorização, mesmo quando não concede carência", async () => {
    const user = await subscriber("u-auth-timestamp");

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "93",
      data: { subscriptionId: "ipx-u-auth-timestamp", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    expect(sub?.authorizedAt).not.toBeNull();
  });

  it("subscription.authorized não rebaixa quem já está ativo, mas estende a carência", async () => {
    const user = await subscriber("u-auth-active", { status: "ACTIVE" });

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "60",
      data: { subscriptionId: "ipx-u-auth-active", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.graceUntil?.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(sub?.authorizedAt).not.toBeNull();
  });

  it("subscription.authorized a partir de SUSPENDED não concede carência quando já foi concedida antes", async () => {
    const user = await subscriber("u-auth-susp", {
      status: "SUSPENDED",
      graceGrantedAt: new Date("2026-08-01T00:00:00Z"),
    });

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "80",
      data: { subscriptionId: "ipx-u-auth-susp", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    expect(sub?.graceUntil).toBeNull();
    expect(sub?.graceGrantedAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(sub?.authorizedAt).not.toBeNull();
  });

  it("subscription.authorized a partir de CANCELED não concede carência quando já foi concedida antes", async () => {
    const user = await subscriber("u-auth-canc", {
      status: "CANCELED",
      graceGrantedAt: new Date("2026-08-01T00:00:00Z"),
    });

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "81",
      data: { subscriptionId: "ipx-u-auth-canc", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    expect(sub?.graceUntil).toBeNull();
    expect(sub?.graceGrantedAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("subscription.authorized a partir de AUTH_DENIED não concede carência quando já foi concedida antes", async () => {
    const user = await subscriber("u-auth-denied", {
      status: "AUTH_DENIED",
      graceGrantedAt: new Date("2026-08-01T00:00:00Z"),
    });

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "82",
      data: { subscriptionId: "ipx-u-auth-denied", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    expect(sub?.graceUntil).toBeNull();
    expect(sub?.graceGrantedAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("segunda autorização da mesma assinatura não concede carência de novo, mas o evento é aplicado", async () => {
    const user = await subscriber("u-auth-twice", {
      graceGrantedAt: new Date("2026-01-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-09-20T00:00:00Z"),
    });

    const outcome = await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "91",
      data: { subscriptionId: "ipx-u-auth-twice", externalUserId: user.id },
    });
    expect(outcome).toBe("applied");

    const sub = await subOf(user.id);
    expect(sub?.lastAppliedEventId).toBe(91n);
    expect(sub?.graceGrantedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(sub?.graceUntil).toBeNull();
    expect(sub?.authorizedAt).not.toBeNull();
  });

  it("primeira autorização de quem está em trial vigente concede carência e grava o instante — não pode perder o acesso que já tinha", async () => {
    const user = await subscriber("u-auth-first-trial", {
      trialEndsAt: new Date("2026-12-01T00:00:00Z"),
    });

    const outcome = await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "92",
      data: { subscriptionId: "ipx-u-auth-first-trial", externalUserId: user.id },
    });
    expect(outcome).toBe("applied");

    const sub = await subOf(user.id);
    expect(sub?.graceUntil?.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(sub?.graceGrantedAt).not.toBeNull();
    expect(sub?.authorizedAt).not.toBeNull();
  });

  it("primeira autorização de quem nunca teve acesso (sem trial vigente) não concede carência, mas grava o instante da autorização", async () => {
    const user = await subscriber("u-auth-first-no-access");

    const outcome = await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "94",
      data: { subscriptionId: "ipx-u-auth-first-no-access", externalUserId: user.id },
    });
    expect(outcome).toBe("applied");

    const sub = await subOf(user.id);
    expect(sub?.graceUntil).toBeNull();
    expect(sub?.graceGrantedAt).toBeNull();
    expect(sub?.authorizedAt).not.toBeNull();
  });

  it("subscription.authorized estende a carência até o vencimento mais sete dias, para quem já tinha acesso via trial", async () => {
    const user = await subscriber("u-grace", { trialEndsAt: new Date("2026-12-01T00:00:00Z") });

    await applyInterPixEvent({
      type: "subscription.authorized",
      eventId: "12",
      data: { subscriptionId: "ipx-u-grace", externalUserId: user.id },
    });

    const sub = await subOf(user.id);
    expect(sub?.graceUntil?.toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("cycle.failed mantém o acesso — dunning não é corte", async () => {
    const user = await subscriber("u-failed", { status: "ACTIVE" });

    await applyInterPixEvent({
      type: "cycle.failed",
      eventId: "13",
      data: { subscriptionId: "ipx-u-failed", cycleSeq: 2, reason: "saldo insuficiente" },
    });

    const sub = await subOf(user.id);
    expect(sub?.status).toBe("ACTIVE");
  });

  it("cycle.failed grava o motivo, em vez de descartá-lo", async () => {
    const user = await subscriber("u-failed-reason", { status: "ACTIVE" });

    await applyInterPixEvent({
      type: "cycle.failed",
      eventId: "17",
      data: { subscriptionId: "ipx-u-failed-reason", cycleSeq: 2, reason: "saldo insuficiente" },
    });

    const sub = await subOf(user.id);
    expect(sub?.lastFailureReason).toBe("saldo insuficiente");
  });

  it("cycle.failed com motivo nulo (falha real de débito, sem texto do Inter) grava null explicitamente", async () => {
    const user = await subscriber("u-failed-null-reason", {
      status: "ACTIVE",
      lastFailureReason: "motivo anterior",
    });

    await applyInterPixEvent({
      type: "cycle.failed",
      eventId: "18",
      data: { subscriptionId: "ipx-u-failed-null-reason", cycleSeq: 3, reason: null },
    });

    const sub = await subOf(user.id);
    expect(sub?.lastFailureReason).toBeNull();
  });

  it("cycle.failed distingue falha de infraestrutura, para diferenciar de inadimplência na mensagem ao usuário", async () => {
    const user = await subscriber("u-failed-infra", { status: "ACTIVE" });

    await applyInterPixEvent({
      type: "cycle.failed",
      eventId: "19",
      data: {
        subscriptionId: "ipx-u-failed-infra",
        cycleSeq: 2,
        reason: "JANELA_DE_ENVIO_EXPIRADA",
      },
    });

    const sub = await subOf(user.id);
    expect(sub?.lastFailureReason).toBe("JANELA_DE_ENVIO_EXPIRADA");
  });

  it("subscription.past_due vindo de ACTIVE é aplicado — quem pagava deixou de pagar", async () => {
    const user = await subscriber("u-past-due-from-active", { status: "ACTIVE" });

    const outcome = await applyInterPixEvent({
      type: "subscription.past_due",
      eventId: "70",
      data: { subscriptionId: "ipx-u-past-due-from-active", externalUserId: user.id, retryDate: "2026-09-25" },
    });

    expect(outcome).toBe("applied");
    expect((await subOf(user.id))?.status).toBe("PAST_DUE");
  });

  it("subscription.past_due vindo de PENDING_AUTH não promove — nunca autorizou, não pode ganhar acesso", async () => {
    const user = await subscriber("u-past-due-from-pending", { status: "PENDING_AUTH" });

    const outcome = await applyInterPixEvent({
      type: "subscription.past_due",
      eventId: "71",
      data: { subscriptionId: "ipx-u-past-due-from-pending", externalUserId: user.id, retryDate: "2026-09-25" },
    });

    expect(outcome).toBe("applied");
    const sub = await subOf(user.id);
    expect(sub?.status).toBe("PENDING_AUTH");
    expect(sub?.lastAppliedEventId).toBe(71n);
  });

  it("subscription.past_due vindo de SUSPENDED não devolve acesso", async () => {
    const user = await subscriber("u-past-due-from-suspended", { status: "SUSPENDED" });

    const outcome = await applyInterPixEvent({
      type: "subscription.past_due",
      eventId: "72",
      data: { subscriptionId: "ipx-u-past-due-from-suspended", externalUserId: user.id, retryDate: "2026-09-25" },
    });

    expect(outcome).toBe("applied");
    const sub = await subOf(user.id);
    expect(sub?.status).toBe("SUSPENDED");
    expect(sub?.lastAppliedEventId).toBe(72n);
  });

  it("subscription.past_due vindo de PENDING_AUTH não reaplica se o evento chegar de novo", async () => {
    const user = await subscriber("u-past-due-no-replay", { status: "PENDING_AUTH" });
    const event = {
      type: "subscription.past_due" as const,
      eventId: "73",
      data: { subscriptionId: "ipx-u-past-due-no-replay", externalUserId: user.id, retryDate: "2026-09-25" },
    };

    expect(await applyInterPixEvent(event)).toBe("applied");
    expect(await applyInterPixEvent(event)).toBe("duplicate");
    expect((await subOf(user.id))?.status).toBe("PENDING_AUTH");
  });

  it("subscription.suspended corta o acesso", async () => {
    const user = await subscriber("u-susp", { status: "PAST_DUE" });

    await applyInterPixEvent({
      type: "subscription.suspended",
      eventId: "14",
      data: { subscriptionId: "ipx-u-susp", externalUserId: user.id },
    });

    expect((await subOf(user.id))?.status).toBe("SUSPENDED");
  });

  it("evento repetido não reaplica", async () => {
    const user = await subscriber("u-dup");
    const event = {
      type: "cycle.paid" as const,
      eventId: "20",
      data: { subscriptionId: "ipx-u-dup", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    };

    expect(await applyInterPixEvent(event)).toBe("applied");
    expect(await applyInterPixEvent(event)).toBe("duplicate");
    expect((await subOf(user.id))?.lastAppliedEventId).toBe(20n);
  });

  it("colisão de escrita concorrente não é confundida com evento obsoleto — devolve conflict para reentrega, e a reentrega aplica", async () => {
    const user = await subscriber("u-conflict", { status: "PENDING_AUTH" });
    const before = await subOf(user.id);
    const subscriptionRowId = before?.id as string;

    let releaseLock: (() => void) | undefined;
    const lockAcquired = new Promise<void>((resolveAcquired) => {
      void testDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT id FROM "subscription" WHERE id = $1 FOR UPDATE`,
          subscriptionRowId,
        );
        resolveAcquired();
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        await tx.subscription.update({
          where: { id: subscriptionRowId },
          data: { status: "ACTIVE" },
        });
      });
    });

    await lockAcquired;

    const outcomePromise = applyInterPixEvent({
      type: "subscription.suspended",
      eventId: "60",
      data: { subscriptionId: "ipx-u-conflict", externalUserId: user.id },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseLock?.();

    const outcome = await outcomePromise;

    expect(outcome).toBe("conflict");
    const midSub = await subOf(user.id);
    expect(midSub?.status).toBe("ACTIVE");
    expect(midSub?.lastAppliedEventId).toBeNull();

    const retry = await applyInterPixEvent({
      type: "subscription.suspended",
      eventId: "60",
      data: { subscriptionId: "ipx-u-conflict", externalUserId: user.id },
    });

    expect(retry).toBe("applied");
    const finalSub = await subOf(user.id);
    expect(finalSub?.status).toBe("SUSPENDED");
    expect(finalSub?.lastAppliedEventId).toBe(60n);
  });

  it("subscription.canceled grava o pendingCycleSeq, em vez de descartá-lo, para avisar de cobrança já a caminho", async () => {
    const user = await subscriber("u-canceled-pending");

    await applyInterPixEvent({
      type: "subscription.canceled",
      eventId: "31",
      data: { subscriptionId: "ipx-u-canceled-pending", externalUserId: user.id, pendingCycleSeq: 5 },
    });

    const sub = await subOf(user.id);
    expect(sub?.status).toBe("CANCELED");
    expect(sub?.pendingCycleSeq).toBe(5);
  });

  it("subscription.canceled sem pendingCycleSeq grava null, sem inventar cobrança pendente", async () => {
    const user = await subscriber("u-canceled-sem-pending");

    await applyInterPixEvent({
      type: "subscription.canceled",
      eventId: "32",
      data: { subscriptionId: "ipx-u-canceled-sem-pending", externalUserId: user.id, pendingCycleSeq: null },
    });

    const sub = await subOf(user.id);
    expect(sub?.status).toBe("CANCELED");
    expect(sub?.pendingCycleSeq).toBeNull();
  });

  it("evento atrasado não reativa quem já cancelou", async () => {
    const user = await subscriber("u-stale");

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

  it("entregas concorrentes não deixam o evento mais antigo vencer", async () => {
    const user = await subscriber("u-race");

    const outcomes = await Promise.all([
      applyInterPixEvent({
        type: "subscription.canceled",
        eventId: "41",
        data: { subscriptionId: "ipx-u-race", externalUserId: user.id, pendingCycleSeq: null },
      }),
      applyInterPixEvent({
        type: "cycle.paid",
        eventId: "40",
        data: { subscriptionId: "ipx-u-race", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
      }),
    ]);

    expect(outcomes).toContain("applied");

    const sub = await subOf(user.id);
    expect(sub?.status).toBe("CANCELED");
    expect(sub?.lastAppliedEventId).toBe(41n);
  });

  it("compara eventId como número: 1000 é mais novo que 999", async () => {
    const user = await subscriber("u-bigint");

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

  it("eventId não numérico é rejeitado sem lançar e sem tocar na assinatura", async () => {
    const user = await subscriber("u-invalid");

    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "evt_7a3f",
      data: { subscriptionId: "ipx-u-invalid", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("invalid");
    const sub = await subOf(user.id);
    expect(sub?.status).toBe("PENDING_AUTH");
    expect(sub?.lastAppliedEventId).toBeNull();
    expect(await testDb.processedWebhookEvent.count()).toBe(0);
  });

  it("eventId vazio é rejeitado em vez de virar zero", async () => {
    const user = await subscriber("u-empty");

    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "",
      data: { subscriptionId: "ipx-u-empty", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("invalid");
    expect((await subOf(user.id))?.lastAppliedEventId).toBeNull();
    expect(await testDb.processedWebhookEvent.count()).toBe(0);
  });

  it("assinatura desconhecida não quebra, não cria nada e não marca o evento como processado", async () => {
    const outcome = await applyInterPixEvent({
      type: "cycle.paid",
      eventId: "40",
      data: { subscriptionId: "ipx-nao-existe", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
    });

    expect(outcome).toBe("unknown");
    expect(await testDb.subscription.count()).toBe(0);
    expect(await testDb.processedWebhookEvent.count()).toBe(0);
  });
});
