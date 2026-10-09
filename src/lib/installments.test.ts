import { describe, expect, it } from "vitest";
import { fifthBusinessDayOfMonth } from "./business-days";
import {
  buildSchedule,
  parsePaymentChoice,
  planPayment,
  splitAmount,
  summarize,
  type InstallmentPlan,
} from "./installments";

const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12);
const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

function paid(number: number, amountCents: number): InstallmentPlan {
  return { number, amountCents, dueDate: noon(2026, 10 + number - 1, 5), forecastPreset: "DAY_FIVE", paidAt: noon(2026, 10, 1) };
}

describe("splitAmount", () => {
  it("joga o resto na última parcela", () => {
    expect(splitAmount(10000, 3)).toEqual([3333, 3333, 3334]);
  });

  it("divide exato quando possível", () => {
    expect(splitAmount(30000, 3)).toEqual([10000, 10000, 10000]);
  });

  it("aceita total menor que o número de parcelas", () => {
    expect(splitAmount(2, 3)).toEqual([0, 0, 2]);
  });
});

describe("buildSchedule", () => {
  it("Dia 5 repete o dia 5 nos meses seguintes, virando o ano", () => {
    expect(buildSchedule(noon(2026, 10, 5), "DAY_FIVE", 3).map(ymd)).toEqual([
      "2026-11-05",
      "2026-12-05",
      "2027-01-05",
    ]);
  });

  it("5º dia útil é recalculado em cada mês", () => {
    const first = fifthBusinessDayOfMonth(2026, 10);
    const schedule = buildSchedule(first, "FIFTH_BUSINESS_DAY", 3);
    expect(schedule.map(ymd)).toEqual([
      ymd(fifthBusinessDayOfMonth(2026, 10)),
      ymd(fifthBusinessDayOfMonth(2026, 11)),
      ymd(fifthBusinessDayOfMonth(2027, 0)),
    ]);
  });

  it("data personalizada no dia 31 cai no último dia em mês curto e volta ao 31 depois", () => {
    expect(buildSchedule(noon(2027, 0, 31), "CUSTOM", 3).map(ymd)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });

  it("todas as datas ficam ao meio-dia local", () => {
    for (const d of buildSchedule(noon(2026, 10, 5), "DAY_FIVE", 3)) expect(d.getHours()).toBe(12);
  });
});

describe("parsePaymentChoice", () => {
  const now = noon(2026, 9, 9);

  it("à vista paga", () => {
    expect(parsePaymentChoice({ mode: "CASH", status: "PAID", count: 1, preset: "", dueDate: null }, now)).toEqual({
      mode: "CASH",
      paidNow: true,
    });
  });

  it("à vista pendente sem previsão continua sem previsão", () => {
    expect(parsePaymentChoice({ mode: "CASH", status: "PENDING", count: 1, preset: "", dueDate: null }, now)).toEqual({
      mode: "CASH",
      paidNow: false,
      preset: null,
      firstDue: null,
    });
  });

  it("parcelado com preset sem data calcula a 1ª data", () => {
    const choice = parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 3, preset: "DAY_FIVE", dueDate: null }, now);
    expect(choice).toMatchObject({ mode: "INSTALLMENTS", count: 3, preset: "DAY_FIVE" });
    expect(ymd((choice as { firstDue: Date }).firstDue)).toBe("2026-11-05");
  });

  it("parcelado com data e sem preset vira CUSTOM", () => {
    const choice = parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 2, preset: "", dueDate: noon(2026, 9, 20) }, now);
    expect(choice).toMatchObject({ mode: "INSTALLMENTS", preset: "CUSTOM" });
  });

  it("parcelado CUSTOM sem data é recusado", () => {
    expect(parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 2, preset: "CUSTOM", dueDate: null }, now)).toEqual({
      error: "Informe a data da 1ª parcela.",
    });
  });

  it("parcelado fora de 2 a 24 é recusado", () => {
    expect(parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 25, preset: "DAY_FIVE", dueDate: null }, now)).toEqual({
      error: "O parcelamento deve ter de 2 a 24 parcelas.",
    });
    expect(parsePaymentChoice({ mode: "INSTALLMENTS", status: "PENDING", count: 1, preset: "DAY_FIVE", dueDate: null }, now)).toEqual({
      error: "O parcelamento deve ter de 2 a 24 parcelas.",
    });
  });
});

describe("planPayment", () => {
  const now = noon(2026, 9, 9);

  it("à vista paga vira uma parcela paga agora", () => {
    const res = planPayment({ mode: "CASH", paidNow: true }, 5000, [], now);
    expect(res).toEqual({
      ok: true,
      installments: [{ number: 1, amountCents: 5000, dueDate: null, forecastPreset: null, paidAt: now }],
    });
  });

  it("à vista paga preserva a data de pagamento de venda já quitada", () => {
    const before = noon(2026, 8, 1);
    const res = planPayment({ mode: "CASH", paidNow: true }, 6000, [{ number: 1, amountCents: 5000, dueDate: null, forecastPreset: null, paidAt: before }], now);
    expect(res.ok && res.installments[0].paidAt).toEqual(before);
  });

  it("à vista pendente recusa venda parcelada com parcela paga", () => {
    const existing = [paid(1, 3333), { ...paid(2, 3333), paidAt: null }, { ...paid(3, 3334), paidAt: null }];
    expect(planPayment({ mode: "CASH", paidNow: false, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 10000, existing, now)).toEqual({
      ok: false,
      error: "Esta venda tem parcelas pagas. Desfaça os pagamentos antes de mudar para à vista.",
    });
  });

  it("parcelado novo divide o total e monta o calendário", () => {
    const res = planPayment({ mode: "INSTALLMENTS", count: 3, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 10000, [], now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.installments.map((i) => [i.number, i.amountCents, ymd(i.dueDate), i.paidAt])).toEqual([
      [1, 3333, "2026-11-05", null],
      [2, 3333, "2026-12-05", null],
      [3, 3334, "2027-01-05", null],
    ]);
  });

  it("parcelado com parcela paga redistribui só o saldo", () => {
    const existing = [paid(1, 3333), { ...paid(2, 3333), paidAt: null }, { ...paid(3, 3334), paidAt: null }];
    const res = planPayment({ mode: "INSTALLMENTS", count: 3, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 12000, existing, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.installments.map((i) => [i.number, i.amountCents, i.paidAt !== null])).toEqual([
      [1, 3333, true],
      [2, 4333, false],
      [3, 4334, false],
    ]);
  });

  it("recusa total menor que o já pago", () => {
    const existing = [paid(1, 5000), { ...paid(2, 5000), paidAt: null }];
    expect(planPayment({ mode: "INSTALLMENTS", count: 2, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 4000, existing, now)).toEqual({
      ok: false,
      error: "O novo total é menor que o valor já pago.",
    });
  });

  it("recusa reduzir parcelas abaixo da maior parcela paga", () => {
    const existing = [{ ...paid(1, 3333), paidAt: null }, { ...paid(2, 3333), paidAt: null }, paid(3, 3334)];
    expect(planPayment({ mode: "INSTALLMENTS", count: 2, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 10000, existing, now)).toEqual({
      ok: false,
      error: "O número de parcelas não pode ser menor que 3, porque já há parcelas pagas.",
    });
  });

  it("recusa saldo sem parcela em aberto para receber", () => {
    const existing = [paid(1, 5000), paid(2, 5000)];
    expect(planPayment({ mode: "INSTALLMENTS", count: 2, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 12000, existing, now)).toEqual({
      ok: false,
      error: "Todas as parcelas já foram pagas. Aumente o número de parcelas para cobrar a diferença.",
    });
  });

  it("saldo zero descarta parcelas em aberto", () => {
    const existing = [paid(1, 5000), { ...paid(2, 5000), paidAt: null }];
    const res = planPayment({ mode: "INSTALLMENTS", count: 2, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 5000, existing, now);
    expect(res.ok && res.installments.map((i) => i.number)).toEqual([1]);
  });

  it("total zero sem parcela paga gera todas as parcelas em aberto com valor zero", () => {
    const res = planPayment({ mode: "INSTALLMENTS", count: 3, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 0, [], now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.installments.map((i) => [i.number, i.amountCents, ymd(i.dueDate), i.paidAt])).toEqual([
      [1, 0, "2026-11-05", null],
      [2, 0, "2026-12-05", null],
      [3, 0, "2027-01-05", null],
    ]);
  });

  it("total zero com parcela paga de valor zero mantém só as pagas", () => {
    const existing = [paid(1, 0), { ...paid(2, 0), paidAt: null }];
    const res = planPayment({ mode: "INSTALLMENTS", count: 2, preset: "DAY_FIVE", firstDue: noon(2026, 10, 5) }, 0, existing, now);
    expect(res.ok && res.installments.map((i) => [i.number, i.amountCents])).toEqual([[1, 0]]);
  });
});

describe("summarize", () => {
  it("venda com parcela em aberto fica pendente com a próxima previsão", () => {
    const list = [paid(1, 3333), { ...paid(2, 3333), paidAt: null }, { ...paid(3, 3334), paidAt: null }];
    expect(summarize(list)).toEqual({
      status: "PENDING",
      paidAt: null,
      paymentForecastDate: list[1].dueDate,
      forecastPreset: "DAY_FIVE",
      openCents: 6667,
      installmentCount: 3,
    });
  });

  it("venda toda paga fica paga com a data do último pagamento", () => {
    const last = noon(2026, 11, 20);
    const list = [paid(1, 5000), { ...paid(2, 5000), paidAt: last }];
    expect(summarize(list)).toEqual({
      status: "PAID",
      paidAt: last,
      paymentForecastDate: null,
      forecastPreset: null,
      openCents: 0,
      installmentCount: 2,
    });
  });
});
