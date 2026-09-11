import { describe, expect, it } from "vitest";
import { checkoutViewState, type CheckoutViewState } from "./checkout-state";

function pixState(
  status: string | null,
  pixCopyPaste: string | null,
  nextDueDate: string | null,
  authorizedAt: string | null,
  graceUntil: string | null,
  now?: Date,
): CheckoutViewState {
  return checkoutViewState(
    "INTERPIX",
    status,
    pixCopyPaste,
    nextDueDate,
    authorizedAt,
    graceUntil,
    now ?? new Date(),
  );
}

describe("estado de checkout derivado do servidor", () => {
  it("autorização pendente com copia-e-cola pede para autorizar o débito", () => {
    expect(pixState("PENDING_AUTH", "00020126...", "2026-09-12", null, null)).toEqual({
      kind: "authorize",
      pixCopyPaste: "00020126...",
      nextDueDate: "2026-09-12",
    });
  });

  it("autorização já chegada (authorizedAt gravado) aguarda a primeira cobrança, mesmo com copia-e-cola ainda presente", () => {
    expect(
      pixState(
        "PENDING_AUTH",
        "00020126...",
        "2026-09-12",
        "2026-09-13T00:00:00.000Z",
        "2026-09-27",
      ),
    ).toEqual({
      kind: "waiting",
      nextDueDate: "2026-09-12",
    });
  });

  it("autorização chegada sem carência concedida também sai do estado de autorizar", () => {
    expect(
      pixState(
        "PENDING_AUTH",
        "00020126...",
        "2026-09-12",
        "2026-09-13T00:00:00.000Z",
        null,
      ),
    ).toEqual({
      kind: "waiting",
      nextDueDate: "2026-09-12",
    });
  });

  it("sem copia-e-cola e sem autorização: a cobrança não foi gerada, estado de falha", () => {
    expect(pixState("PENDING_AUTH", null, "2026-09-12", null, null)).toEqual({
      kind: "failed",
    });
  });

  it("assinatura no cartão (STRIPE) nunca dispara os cards de Pix", () => {
    expect(
      checkoutViewState("STRIPE", "PENDING_AUTH", null, "2026-09-12", null, null),
    ).toEqual({ kind: "none" });
  });

  it("assinatura ativa não mostra nenhum dos estados de checkout", () => {
    expect(pixState("ACTIVE", null, null, null, null)).toEqual({ kind: "none" });
    expect(pixState("ACTIVE", "00020126...", "2026-09-12", null, null)).toEqual({
      kind: "none",
    });
  });

  it("sem assinatura não mostra nenhum dos estados de checkout", () => {
    expect(pixState(null, null, null, null, null)).toEqual({ kind: "none" });
  });

  it("outros status (encerrado, negado, suspenso) também caem no estado normal", () => {
    expect(pixState("CANCELED", null, null, null, null)).toEqual({ kind: "none" });
    expect(pixState("AUTH_DENIED", null, null, null, null)).toEqual({ kind: "none" });
    expect(pixState("PAST_DUE", null, null, null, null)).toEqual({ kind: "none" });
  });

  it("carência vencida: cobrança não foi debitada, estado de falha em vez de espera", () => {
    const now = new Date("2026-09-28T00:00:00.000Z");
    expect(
      pixState(
        "PENDING_AUTH",
        "00020126...",
        "2026-09-12",
        "2026-09-13T00:00:00.000Z",
        "2026-09-27",
        now,
      ),
    ).toEqual({
      kind: "expired",
      nextDueDate: "2026-09-12",
    });
  });

  it("graceUntil não interpretável cai no estado de falha, não no de espera", () => {
    expect(
      pixState(
        "PENDING_AUTH",
        "00020126...",
        "2026-09-12",
        "2026-09-13T00:00:00.000Z",
        "data-invalida",
      ),
    ).toEqual({ kind: "failed" });
  });

  it("carência ainda válida continua no estado de espera", () => {
    const now = new Date("2026-09-20T00:00:00.000Z");
    expect(
      pixState(
        "PENDING_AUTH",
        "00020126...",
        "2026-09-12",
        "2026-09-13T00:00:00.000Z",
        "2026-09-27",
        now,
      ),
    ).toEqual({
      kind: "waiting",
      nextDueDate: "2026-09-12",
    });
  });
});
