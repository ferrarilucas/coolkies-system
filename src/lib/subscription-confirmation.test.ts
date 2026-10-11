import { describe, expect, it } from "vitest";
import { confirmationOutcome, type SubscriptionState } from "./subscription-confirmation";

function state(over: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    status: "PENDING_AUTH",
    provider: "INTERPIX",
    authorized: false,
    plan: "corre",
    cycle: "MONTHLY",
    nextDueDate: "2026-10-20",
    ...over,
  };
}

describe("confirmationOutcome", () => {
  it("sem assinatura aguarda", () => {
    expect(confirmationOutcome(null)).toBe("waiting");
  });

  it("Pix sem autorização aguarda", () => {
    expect(confirmationOutcome(state())).toBe("waiting");
  });

  it("Pix autorizado confirma, mesmo ainda em PENDING_AUTH", () => {
    expect(confirmationOutcome(state({ authorized: true }))).toBe("confirmed");
  });

  it("Pix já autorizado quando a tela conecta também confirma", () => {
    expect(confirmationOutcome(state({ status: "ACTIVE", authorized: true }))).toBe("confirmed");
  });

  it("cartão aguarda até o webhook ativar", () => {
    expect(confirmationOutcome(state({ provider: "STRIPE" }))).toBe("waiting");
  });

  it("cartão ativo confirma", () => {
    expect(confirmationOutcome(state({ provider: "STRIPE", status: "ACTIVE" }))).toBe("confirmed");
  });

  it("autorização negada falha", () => {
    expect(confirmationOutcome(state({ status: "AUTH_DENIED" }))).toBe("failed");
  });
});
