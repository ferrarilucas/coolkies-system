import { describe, expect, it } from "vitest";
import { addMonths, advancePeriod, hasPaidAccess, isPeriodPaid } from "./period";

describe("addMonths", () => {
  it("preserva o dia quando o mês de destino tem dias suficientes", () => {
    expect(addMonths(new Date("2026-01-15T10:00:00Z"), 1).toISOString()).toBe(
      "2026-02-15T10:00:00.000Z",
    );
  });

  it("ajusta para o último dia do mês de destino quando o dia de origem não existe nele", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });
});

describe("advancePeriod", () => {
  it("mensal avança um mês", () => {
    expect(advancePeriod(new Date("2026-09-20T00:00:00Z"), "MONTHLY").toISOString()).toBe(
      "2026-10-20T00:00:00.000Z",
    );
  });

  it("anual avança doze meses", () => {
    expect(advancePeriod(new Date("2026-09-20T00:00:00Z"), "YEARLY").toISOString()).toBe(
      "2027-09-20T00:00:00.000Z",
    );
  });
});

describe("isPeriodPaid", () => {
  it("pagamento liquidado horas antes do vencimento conta como período pago — reflete o fixture canônico de interpix-events.test.ts: pago em 2026-09-19T09:00Z, período termina em 2026-09-20T00:00Z; o evento de cycle.paid grava paidThroughAt com o novo currentPeriodEnd, não com o instante do pagamento, por isso a comparação é exata, sem aritmética", () => {
    const sub = {
      paidThroughAt: new Date("2026-09-20T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-20T00:00:00.000Z"),
    };
    expect(isPeriodPaid(sub)).toBe(true);
  });

  it("paidThroughAt horas depois do fim do período também conta como pago", () => {
    const sub = {
      paidThroughAt: new Date("2026-09-20T09:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-20T00:00:00.000Z"),
    };
    expect(isPeriodPaid(sub)).toBe(true);
  });

  it("paidThroughAt horas antes do fim do período não cobre o período", () => {
    const sub = {
      paidThroughAt: new Date("2026-09-19T15:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-20T00:00:00.000Z"),
    };
    expect(isPeriodPaid(sub)).toBe(false);
  });

  it("sem paidThroughAt não há período pago", () => {
    expect(
      isPeriodPaid({ paidThroughAt: null, currentPeriodEnd: new Date("2026-09-20T00:00:00Z") }),
    ).toBe(false);
  });

  it("sem currentPeriodEnd não há período pago", () => {
    expect(
      isPeriodPaid({ paidThroughAt: new Date("2026-09-20T00:00:00Z"), currentPeriodEnd: null }),
    ).toBe(false);
  });
});

describe("hasPaidAccess", () => {
  it("PAST_DUE: basta ter pago alguma vez, o período em aberto não importa", () => {
    expect(
      hasPaidAccess({
        status: "PAST_DUE",
        lastPaidAt: new Date("2026-01-10"),
        paidThroughAt: null,
        currentPeriodEnd: new Date("2026-09-30"),
      }),
    ).toBe(true);
  });

  it("PAST_DUE: nunca ter pago não dá cobertura", () => {
    expect(
      hasPaidAccess({
        status: "PAST_DUE",
        lastPaidAt: null,
        paidThroughAt: null,
        currentPeriodEnd: new Date("2026-09-30"),
      }),
    ).toBe(false);
  });

  it("CANCELED: exige o período em aberto coberto pelo paidThroughAt", () => {
    expect(
      hasPaidAccess({
        status: "CANCELED",
        lastPaidAt: new Date("2026-09-01"),
        paidThroughAt: new Date("2026-08-01"),
        currentPeriodEnd: new Date("2026-09-30"),
      }),
    ).toBe(false);

    expect(
      hasPaidAccess({
        status: "CANCELED",
        lastPaidAt: new Date("2026-09-01"),
        paidThroughAt: new Date("2026-09-30"),
        currentPeriodEnd: new Date("2026-09-30"),
      }),
    ).toBe(true);
  });

  it("outros status não concedem cobertura por essa função — cada status tem sua própria regra", () => {
    expect(
      hasPaidAccess({
        status: "ACTIVE",
        lastPaidAt: new Date("2026-09-01"),
        paidThroughAt: new Date("2026-09-30"),
        currentPeriodEnd: new Date("2026-09-30"),
      }),
    ).toBe(false);
  });
});
