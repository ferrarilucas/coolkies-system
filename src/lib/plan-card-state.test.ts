import { describe, expect, it } from "vitest";
import { isCurrentPlanCard } from "./plan-card-state";

function base(overrides: Partial<Parameters<typeof isCurrentPlanCard>[0]> = {}) {
  return {
    hasSubscriptionId: true,
    currentPlan: "corre",
    currentCycle: "MONTHLY",
    planId: "corre",
    cycle: "MONTHLY",
    status: "ACTIVE",
    isExpiredThisPlan: false,
    ...overrides,
  };
}

describe("isCurrentPlanCard", () => {
  it("assinatura ativa no mesmo plano e ciclo é o plano atual", () => {
    expect(isCurrentPlanCard(base({ status: "ACTIVE" }))).toBe(true);
  });

  it("assinatura em atraso (PAST_DUE) continua sendo o plano atual", () => {
    expect(isCurrentPlanCard(base({ status: "PAST_DUE" }))).toBe(true);
  });

  it("autorização pendente ainda não vencida continua sendo o plano atual", () => {
    expect(isCurrentPlanCard(base({ status: "PENDING_AUTH" }))).toBe(true);
  });

  it("suspensa por falta de pagamento não trava o card como plano atual — precisa poder recontratar", () => {
    expect(isCurrentPlanCard(base({ status: "SUSPENDED" }))).toBe(false);
  });

  it("autorização recusada pelo banco não trava o card como plano atual", () => {
    expect(isCurrentPlanCard(base({ status: "AUTH_DENIED" }))).toBe(false);
  });

  it("assinatura cancelada não trava o card como plano atual", () => {
    expect(isCurrentPlanCard(base({ status: "CANCELED" }))).toBe(false);
  });

  it("carência vencida (isExpiredThisPlan) não trava o card, mesmo com status ainda PENDING_AUTH", () => {
    expect(
      isCurrentPlanCard(base({ status: "PENDING_AUTH", isExpiredThisPlan: true })),
    ).toBe(false);
  });

  it("plano ou ciclo diferentes nunca são o plano atual", () => {
    expect(isCurrentPlanCard(base({ planId: "cresce" }))).toBe(false);
    expect(isCurrentPlanCard(base({ cycle: "YEARLY" }))).toBe(false);
  });

  it("sem id de assinatura (trial puro) nunca é o plano atual", () => {
    expect(isCurrentPlanCard(base({ hasSubscriptionId: false }))).toBe(false);
  });
});
