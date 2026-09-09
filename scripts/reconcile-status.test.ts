import { describe, expect, it } from "vitest";
import { decidePeriodEndCorrection, decideReconcile } from "./reconcile-status";

describe("conciliação InterPix — decisão de status", () => {
  it("status remoto desconhecido nunca muda estado — só relata", () => {
    const decision = decideReconcile({ local: "ACTIVE", remote: "COISA_NOVA" });
    expect(decision.action).toBe("report");
  });

  it("estados iguais não fazem nada", () => {
    const decision = decideReconcile({ local: "ACTIVE", remote: "ACTIVE" });
    expect(decision.action).toBe("none");
  });

  it("rebaixamento para SUSPENDED é aplicado", () => {
    const decision = decideReconcile({ local: "ACTIVE", remote: "SUSPENDED" });
    expect(decision).toMatchObject({ action: "apply", status: "SUSPENDED" });
  });

  it("rebaixamento para CANCELED é aplicado", () => {
    const decision = decideReconcile({ local: "ACTIVE", remote: "CANCELED" });
    expect(decision).toMatchObject({ action: "apply", status: "CANCELED" });
  });

  it("rebaixamento para AUTH_DENIED é aplicado", () => {
    const decision = decideReconcile({ local: "PENDING_AUTH", remote: "AUTH_DENIED" });
    expect(decision).toMatchObject({ action: "apply", status: "AUTH_DENIED" });
  });

  it("PAST_DUE remoto vindo de ACTIVE é aplicado — quem pagava deixou de pagar", () => {
    const decision = decideReconcile({ local: "ACTIVE", remote: "PAST_DUE" });
    expect(decision).toMatchObject({ action: "apply", status: "PAST_DUE" });
  });

  it("PAST_DUE remoto vindo de PENDING_AUTH só relata — nunca autorizou, não pode promover", () => {
    const decision = decideReconcile({ local: "PENDING_AUTH", remote: "PAST_DUE" });
    expect(decision.action).toBe("report");
  });

  it("PAST_DUE remoto vindo de SUSPENDED só relata — não devolve acesso a quem foi suspenso", () => {
    const decision = decideReconcile({ local: "SUSPENDED", remote: "PAST_DUE" });
    expect(decision.action).toBe("report");
  });

  it("aplica suspensão perdida (PAST_DUE local, SUSPENDED remoto)", () => {
    const decision = decideReconcile({ local: "PAST_DUE", remote: "SUSPENDED" });
    expect(decision).toMatchObject({ action: "apply", status: "SUSPENDED" });
  });

  it("promoção para ACTIVE a partir de PAST_DUE é aplicada — recuperação legítima", () => {
    const decision = decideReconcile({ local: "PAST_DUE", remote: "ACTIVE" });
    expect(decision).toMatchObject({ action: "apply", status: "ACTIVE" });
  });

  it("promoção para ACTIVE a partir de SUSPENDED é aplicada — recuperação legítima", () => {
    const decision = decideReconcile({ local: "SUSPENDED", remote: "ACTIVE" });
    expect(decision).toMatchObject({ action: "apply", status: "ACTIVE" });
  });

  it("PENDING_AUTH local com ACTIVE remoto apenas relata — ambiguidade não resolvida", () => {
    const decision = decideReconcile({ local: "PENDING_AUTH", remote: "ACTIVE" });
    expect(decision.action).toBe("report");
  });

  it("ACTIVE local com PENDING_AUTH remoto apenas relata — nunca corta quem já pagou", () => {
    const decision = decideReconcile({ local: "ACTIVE", remote: "PENDING_AUTH" });
    expect(decision.action).toBe("report");
  });
});

describe("conciliação InterPix — correção da data de vencimento", () => {
  it("vencimento remoto diferente do local é corrigido", () => {
    const decision = decidePeriodEndCorrection({
      localPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      remoteNextDueDate: "2026-09-01",
    });

    expect(decision.action).toBe("apply");
    expect(decision).toMatchObject({
      action: "apply",
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("vencimento local ausente também é preenchido a partir do remoto", () => {
    const decision = decidePeriodEndCorrection({
      localPeriodEnd: null,
      remoteNextDueDate: "2026-09-01",
    });

    expect(decision.action).toBe("apply");
  });

  it("vencimento igual não gera escrita", () => {
    const decision = decidePeriodEndCorrection({
      localPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      remoteNextDueDate: "2026-09-01",
    });

    expect(decision.action).toBe("none");
  });

  it("vencimento remoto ausente não é aplicado — não derruba a mudança de status legítima", () => {
    const decision = decidePeriodEndCorrection({
      localPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      remoteNextDueDate: "",
    });

    expect(decision.action).toBe("none");
  });

  it("vencimento remoto fora do formato não é aplicado", () => {
    const decision = decidePeriodEndCorrection({
      localPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      remoteNextDueDate: "não é uma data",
    });

    expect(decision.action).toBe("none");
  });
});
