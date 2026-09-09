import { describe, expect, it } from "vitest";
import { checkoutViewState } from "./checkout-state";

describe("estado de checkout derivado do servidor", () => {
  it("autorização pendente com copia-e-cola pede para autorizar o débito", () => {
    expect(checkoutViewState("PENDING_AUTH", "00020126...", "2026-09-12")).toEqual({
      kind: "authorize",
      pixCopyPaste: "00020126...",
      nextDueDate: "2026-09-12",
    });
  });

  it("autorização pendente sem copia-e-cola aguarda a primeira cobrança", () => {
    expect(checkoutViewState("PENDING_AUTH", null, "2026-09-12")).toEqual({
      kind: "waiting",
      nextDueDate: "2026-09-12",
    });
  });

  it("assinatura ativa não mostra nenhum dos estados de checkout", () => {
    expect(checkoutViewState("ACTIVE", null, null)).toEqual({ kind: "none" });
    expect(checkoutViewState("ACTIVE", "00020126...", "2026-09-12")).toEqual({ kind: "none" });
  });

  it("sem assinatura não mostra nenhum dos estados de checkout", () => {
    expect(checkoutViewState(null, null, null)).toEqual({ kind: "none" });
  });

  it("outros status (encerrado, negado, suspenso) também caem no estado normal", () => {
    expect(checkoutViewState("CANCELED", null, null)).toEqual({ kind: "none" });
    expect(checkoutViewState("AUTH_DENIED", null, null)).toEqual({ kind: "none" });
    expect(checkoutViewState("PAST_DUE", null, null)).toEqual({ kind: "none" });
  });
});
