import { describe, expect, it } from "vitest";
import { decideReconcile, hasPaidCurrentCycle, type RemoteCharge } from "./reconcile-status";

const now = new Date("2026-09-01T12:00:00Z");

function charges(...list: RemoteCharge[]): RemoteCharge[] {
  return list;
}

describe("evidencia de pagamento no ciclo corrente", () => {
  it("cobranca RECEIVED com vencimento dentro do ciclo cobre hoje", () => {
    expect(
      hasPaidCurrentCycle(charges({ status: "RECEIVED", dueDate: "2026-08-15" }), "MONTHLY", now),
    ).toBe(true);
  });

  it("cobranca CONFIRMED tambem conta como paga", () => {
    expect(
      hasPaidCurrentCycle(charges({ status: "CONFIRMED", dueDate: "2026-08-15" }), "MONTHLY", now),
    ).toBe(true);
  });

  it("cobranca paga de um ciclo mensal ja vencido nao cobre hoje", () => {
    expect(
      hasPaidCurrentCycle(charges({ status: "RECEIVED", dueDate: "2026-07-01" }), "MONTHLY", now),
    ).toBe(false);
  });

  it("no plano anual a mesma cobranca cobre o ano inteiro", () => {
    expect(
      hasPaidCurrentCycle(charges({ status: "RECEIVED", dueDate: "2026-07-01" }), "YEARLY", now),
    ).toBe(true);
  });

  it("cobranca pendente, vencida ou estornada nao conta como paga", () => {
    for (const status of ["PENDING", "OVERDUE", "REFUNDED", "AWAITING_RISK_ANALYSIS"]) {
      expect(
        hasPaidCurrentCycle(charges({ status, dueDate: "2026-08-15" }), "MONTHLY", now),
      ).toBe(false);
    }
  });

  it("cobranca sem vencimento nao serve de evidencia", () => {
    expect(
      hasPaidCurrentCycle(charges({ status: "RECEIVED", dueDate: null }), "MONTHLY", now),
    ).toBe(false);
  });

  it("sem nenhuma cobranca nao ha evidencia", () => {
    expect(hasPaidCurrentCycle([], "MONTHLY", now)).toBe(false);
  });
});

describe("decisao da reconciliacao", () => {
  it("assinatura recem criada no Asaas e nunca paga nao promove o trial", () => {
    const decision = decideReconcile({
      localStatus: "TRIALING",
      cycle: "MONTHLY",
      charges: charges({ status: "PENDING", dueDate: "2026-09-01" }),
      now,
    });

    expect(decision.action).toBe("none");
  });

  it("trial com cobranca paga e promovido para ACTIVE", () => {
    const decision = decideReconcile({
      localStatus: "TRIALING",
      cycle: "MONTHLY",
      charges: charges({ status: "RECEIVED", dueDate: "2026-08-20" }),
      now,
    });

    expect(decision.action).toBe("activate");
  });

  it("PAST_DUE sem pagamento nao volta para ACTIVE", () => {
    const decision = decideReconcile({
      localStatus: "PAST_DUE",
      cycle: "MONTHLY",
      charges: charges(
        { status: "OVERDUE", dueDate: "2026-08-25" },
        { status: "RECEIVED", dueDate: "2026-07-25" },
      ),
      now,
    });

    expect(decision.action).toBe("none");
  });

  it("PAST_DUE com a cobranca do ciclo corrente paga volta para ACTIVE", () => {
    const decision = decideReconcile({
      localStatus: "PAST_DUE",
      cycle: "MONTHLY",
      charges: charges({ status: "RECEIVED", dueDate: "2026-08-25" }),
      now,
    });

    expect(decision.action).toBe("activate");
  });

  it("assinatura cancelada localmente nunca e reativada", () => {
    const decision = decideReconcile({
      localStatus: "CANCELED",
      cycle: "MONTHLY",
      charges: charges({ status: "RECEIVED", dueDate: "2026-08-25" }),
      now,
    });

    expect(decision.action).toBe("none");
  });

  it("ativa e paga nao gera escrita nem divergencia", () => {
    const decision = decideReconcile({
      localStatus: "ACTIVE",
      cycle: "MONTHLY",
      charges: charges({ status: "RECEIVED", dueDate: "2026-08-25" }),
      now,
    });

    expect(decision.action).toBe("none");
  });

  it("ativa sem pagamento no ciclo corrente vira relatorio, nunca rebaixamento", () => {
    const decision = decideReconcile({
      localStatus: "ACTIVE",
      cycle: "MONTHLY",
      charges: charges({ status: "OVERDUE", dueDate: "2026-08-01" }),
      now,
    });

    expect(decision.action).toBe("report");
  });
});
