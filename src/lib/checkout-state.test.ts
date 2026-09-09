import { describe, expect, it } from "vitest";
import { checkoutViewState } from "./checkout-state";

describe("estado de checkout derivado do servidor", () => {
  it("autorização pendente com copia-e-cola pede para autorizar o débito", () => {
    expect(checkoutViewState("PENDING_AUTH", "00020126...", "2026-09-12", null)).toEqual({
      kind: "authorize",
      pixCopyPaste: "00020126...",
      nextDueDate: "2026-09-12",
    });
  });

  it("autorização já concedida (graceUntil gravado) aguarda a primeira cobrança, mesmo com copia-e-cola ainda presente", () => {
    expect(
      checkoutViewState("PENDING_AUTH", "00020126...", "2026-09-12", "2026-09-27"),
    ).toEqual({
      kind: "waiting",
      nextDueDate: "2026-09-12",
    });
  });

  it("sem copia-e-cola e sem graceUntil: a cobrança não foi gerada, estado de falha", () => {
    expect(checkoutViewState("PENDING_AUTH", null, "2026-09-12", null)).toEqual({
      kind: "failed",
    });
  });

  it("assinatura ativa não mostra nenhum dos estados de checkout", () => {
    expect(checkoutViewState("ACTIVE", null, null, null)).toEqual({ kind: "none" });
    expect(checkoutViewState("ACTIVE", "00020126...", "2026-09-12", null)).toEqual({
      kind: "none",
    });
  });

  it("sem assinatura não mostra nenhum dos estados de checkout", () => {
    expect(checkoutViewState(null, null, null, null)).toEqual({ kind: "none" });
  });

  it("outros status (encerrado, negado, suspenso) também caem no estado normal", () => {
    expect(checkoutViewState("CANCELED", null, null, null)).toEqual({ kind: "none" });
    expect(checkoutViewState("AUTH_DENIED", null, null, null)).toEqual({ kind: "none" });
    expect(checkoutViewState("PAST_DUE", null, null, null)).toEqual({ kind: "none" });
  });
});
