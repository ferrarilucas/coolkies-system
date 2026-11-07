import { fifthBusinessDayOfMonth } from "./business-days";
import { describe, expect, it } from "vitest";
import {
  allocate,
  canSpread,
  orderForAllocation,
  allocationMatches,
  openRowsMatch,
  parseReceiveAmount,
  planPreset,
  planRemainder,
  suggestedRemainderDate,
  type AllocatableInstallment,
  type SaleRow,
} from "./partial-payment";

const NOW = new Date("2026-11-07T15:00:00Z");
const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

const item = (id: string, number: number, amountCents: number, dueDate: Date | null, soldAt = noon(2026, 9, 1)): AllocatableInstallment => ({
  id,
  number,
  amountCents,
  dueDate,
  soldAt,
});

const items = () => [
  item("a", 1, 60_00, noon(2026, 10, 2)),
  item("b", 1, 70_00, noon(2026, 10, 15)),
  item("c", 1, 50_00, noon(2026, 10, 28)),
];

const row = (id: string, number: number, amountCents: number, dueDate: Date | null = null, paidAt: Date | null = null): SaleRow => ({
  id,
  number,
  amountCents,
  dueDate,
  forecastPreset: null,
  paidAt,
});

describe("orderForAllocation", () => {
  it("ordena por vencimento ascendente", () => {
    const shuffled = [items()[2], items()[0], items()[1]];
    expect(orderForAllocation(shuffled).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("usa soldAt como chave quando não há vencimento", () => {
    const list = [
      item("x", 1, 10_00, noon(2026, 10, 20)),
      item("y", 1, 10_00, null, noon(2026, 10, 10)),
      item("z", 1, 10_00, noon(2026, 10, 5)),
    ];
    expect(orderForAllocation(list).map((i) => i.id)).toEqual(["z", "y", "x"]);
  });

  it("desempata por soldAt e depois por number", () => {
    const list = [
      item("p3", 3, 10_00, noon(2026, 10, 5), noon(2026, 9, 2)),
      item("p2", 2, 10_00, noon(2026, 10, 5), noon(2026, 9, 2)),
      item("old", 5, 10_00, noon(2026, 10, 5), noon(2026, 9, 1)),
    ];
    expect(orderForAllocation(list).map((i) => i.id)).toEqual(["old", "p2", "p3"]);
  });

  it("não altera o array original", () => {
    const list = [items()[1], items()[0]];
    orderForAllocation(list);
    expect(list.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("allocate", () => {
  it("abate na ordem e deixa a última tocada como parcial", () => {
    const result = allocate(items(), 100_00);
    expect(result).toEqual({
      ok: true,
      allocation: {
        fullIds: ["a"],
        partial: { id: "b", paidCents: 40_00, remainderCents: 30_00 },
        untouchedIds: ["c"],
      },
    });
  });

  it("na fronteira exata não gera parcial", () => {
    const result = allocate(items(), 130_00);
    expect(result).toEqual({
      ok: true,
      allocation: { fullIds: ["a", "b"], partial: null, untouchedIds: ["c"] },
    });
  });

  it("o total quita todas", () => {
    const result = allocate(items(), 180_00);
    expect(result).toEqual({
      ok: true,
      allocation: { fullIds: ["a", "b", "c"], partial: null, untouchedIds: [] },
    });
  });

  it("recusa zero e negativo", () => {
    expect(allocate(items(), 0)).toEqual({ ok: false, error: "Informe um valor maior que zero." });
    expect(allocate(items(), -5)).toEqual({ ok: false, error: "Informe um valor maior que zero." });
  });

  it("recusa valor acima do total", () => {
    expect(allocate(items(), 180_01)).toEqual({ ok: false, error: "O valor é maior que o total selecionado." });
  });

  it("ordena pela soldAt os itens sem vencimento entre os datados", () => {
    const list = [
      item("late", 1, 50_00, noon(2026, 10, 28)),
      item("nodue", 1, 40_00, null, noon(2026, 10, 10)),
      item("early", 1, 30_00, noon(2026, 10, 2)),
    ];
    const result = allocate(list, 80_00);
    expect(result).toEqual({
      ok: true,
      allocation: {
        fullIds: ["early", "nodue"],
        partial: { id: "late", paidCents: 10_00, remainderCents: 40_00 },
        untouchedIds: [],
      },
    });
  });
});

describe("canSpread", () => {
  it("é verdadeiro quando há parcela aberta seguinte", () => {
    expect(canSpread([row("1", 1, 100), row("2", 2, 100)], 1, [])).toBe(true);
  });

  it("ignora parcelas excluídas do lote", () => {
    const rows = [row("2", 2, 100), row("3", 3, 100)];
    expect(canSpread(rows, 2, ["3"])).toBe(false);
    expect(planRemainder(rows, 2, 3000, { mode: "SPREAD" }, null, NOW, ["3"])).toEqual({
      ok: false,
      error: "Não há parcelas seguintes para diluir.",
    });
  });

  it("é falso quando a parcial é a última", () => {
    expect(canSpread([row("1", 1, 100), row("2", 2, 100)], 2, [])).toBe(false);
  });

  it("ignora parcelas seguintes já pagas", () => {
    expect(canSpread([row("1", 1, 100), row("2", 2, 100, null, noon(2026, 10, 1))], 1, [])).toBe(false);
  });
});

describe("planRemainder", () => {
  it("SPREAD soma o restante nas parcelas abertas seguintes", () => {
    const rows = [row("1", 1, 5000, noon(2026, 10, 5)), row("2", 2, 3333, noon(2026, 11, 5)), row("3", 3, 3333, noon(2026, 12, 5))];
    const result = planRemainder(rows, 1, 3000, { mode: "SPREAD" }, null, NOW, []);
    expect(result).toEqual({
      ok: true,
      plan: {
        updates: [
          { id: "2", amountCents: 4833 },
          { id: "3", amountCents: 4833 },
        ],
        creates: [],
      },
    });
  });

  it("SPREAD distribui o resto de centavos na última parcela", () => {
    const rows = [row("1", 1, 5000, null), row("2", 2, 1000, null), row("3", 3, 1000, null)];
    const result = planRemainder(rows, 1, 3001, { mode: "SPREAD" }, null, NOW, []);
    expect(result).toEqual({
      ok: true,
      plan: {
        updates: [
          { id: "2", amountCents: 2500 },
          { id: "3", amountCents: 2501 },
        ],
        creates: [],
      },
    });
  });

  it("SPREAD erra quando a parcial é a última", () => {
    const rows = [row("1", 1, 5000, null), row("2", 2, 5000, null)];
    expect(planRemainder(rows, 2, 3000, { mode: "SPREAD" }, null, NOW, [])).toEqual({
      ok: false,
      error: "Não há parcelas seguintes para diluir.",
    });
  });

  it("APPEND com preset cria a parcela no mês seguinte ao último vencimento", () => {
    const rows = [
      row("1", 1, 5000, noon(2026, 10, 5)),
      row("2", 2, 5000, noon(2026, 11, 5)),
      row("3", 3, 5000, noon(2026, 12, 5)),
    ];
    const result = planRemainder(rows, 1, 3000, { mode: "APPEND" }, "DAY_FIVE", NOW, []);
    expect(result).toEqual({
      ok: true,
      plan: {
        updates: [],
        creates: [{ amountCents: 3000, dueDate: noon(2027, 1, 5), forecastPreset: "DAY_FIVE", placeAfterNumber: 3 }],
      },
    });
  });

  it("APPEND sem preset soma um mês ao maior vencimento", () => {
    const rows = [row("1", 1, 5000, noon(2026, 10, 31)), row("2", 2, 5000, noon(2026, 11, 30))];
    const result = planRemainder(rows, 1, 3000, { mode: "APPEND" }, null, NOW, []);
    expect(result).toEqual({
      ok: true,
      plan: {
        updates: [],
        creates: [{ amountCents: 3000, dueDate: noon(2026, 12, 30), forecastPreset: "CUSTOM", placeAfterNumber: 2 }],
      },
    });
  });

  it("APPEND sem vencimento usa hoje em São Paulo mais um mês", () => {
    const rows = [row("1", 1, 5000, null)];
    const now = new Date("2026-11-08T01:00:00Z");
    expect(planRemainder(rows, 1, 3000, { mode: "APPEND" }, null, now, [])).toEqual({
      ok: true,
      plan: {
        updates: [],
        creates: [{ amountCents: 3000, dueDate: noon(2026, 12, 7), forecastPreset: "CUSTOM", placeAfterNumber: 1 }],
      },
    });
  });

  it("recusa restante zero, negativo ou fracionado", () => {
    const rows = [row("1", 1, 5000, null), row("2", 2, 5000, null)];
    for (const cents of [0, -1, 10.5]) {
      expect(planRemainder(rows, 1, cents, { mode: "APPEND" }, null, NOW, [])).toEqual({
        ok: false,
        error: "Informe um valor maior que zero.",
      });
    }
  });

  it("NEW_DATE cria a parcela logo após a parcial", () => {
    const rows = [row("1", 1, 5000, noon(2026, 10, 5)), row("2", 2, 5000, noon(2026, 11, 5))];
    const result = planRemainder(rows, 1, 3000, { mode: "NEW_DATE", dueDate: "2026-12-20" }, "DAY_FIVE", NOW, []);
    expect(result).toEqual({
      ok: true,
      plan: {
        updates: [],
        creates: [{ amountCents: 3000, dueDate: noon(2026, 12, 20), forecastPreset: "CUSTOM", placeAfterNumber: 1 }],
      },
    });
  });

  it("NEW_DATE recusa data inexistente", () => {
    const rows = [row("1", 1, 5000, null)];
    expect(planRemainder(rows, 1, 3000, { mode: "NEW_DATE", dueDate: "2026-02-30" }, null, NOW, [])).toEqual({
      ok: false,
      error: "Informe uma data válida.",
    });
  });
});

describe("suggestedRemainderDate", () => {
  const now = noon(2026, 11, 7);

  it("sem preset sugere 30 dias à frente", () => {
    expect(suggestedRemainderDate(null, now)).toEqual(noon(2026, 12, 7));
  });

  it("CUSTOM sugere um mês à frente", () => {
    expect(suggestedRemainderDate("CUSTOM", noon(2026, 1, 31))).toEqual(noon(2026, 2, 28));
  });

  it("DAY_FIVE sugere o próximo dia 5", () => {
    expect(suggestedRemainderDate("DAY_FIVE", now)).toEqual(noon(2026, 12, 5));
  });

  it("FIFTH_BUSINESS_DAY sugere o 5º dia útil", () => {
    const expected = fifthBusinessDayOfMonth(2026, 10);
    expect(suggestedRemainderDate("FIFTH_BUSINESS_DAY", now)).toEqual(noon(2026, 11, expected.getDate()));
  });

  it("usa o dia de calendário de São Paulo", () => {
    expect(suggestedRemainderDate(null, new Date("2026-11-08T01:00:00Z"))).toEqual(noon(2026, 12, 7));
  });
});

describe("parseReceiveAmount", () => {
  it("interpreta formato brasileiro", () => {
    expect(parseReceiveAmount("1.234,5", 200000)).toEqual({ ok: true, cents: 123450 });
  });

  it("aceita o máximo exato", () => {
    expect(parseReceiveAmount("2.000,00", 200000)).toEqual({ ok: true, cents: 200000 });
  });

  it("recusa não numérico e vazio", () => {
    expect(parseReceiveAmount("abc", 200000)).toEqual({ ok: false, error: "Informe o valor recebido." });
    expect(parseReceiveAmount("", 200000)).toEqual({ ok: false, error: "Informe o valor recebido." });
    expect(parseReceiveAmount("   ", 200000)).toEqual({ ok: false, error: "Informe o valor recebido." });
  });

  it("recusa acima do máximo", () => {
    expect(parseReceiveAmount("2.000,01", 200000)).toEqual({
      ok: false,
      error: "O valor é maior que o total selecionado.",
    });
  });

  it("aceita formatos válidos", () => {
    expect(parseReceiveAmount("R$ 10,50", 200000)).toEqual({ ok: true, cents: 1050 });
    expect(parseReceiveAmount("1.234,56", 200000)).toEqual({ ok: true, cents: 123456 });
    expect(parseReceiveAmount("10", 200000)).toEqual({ ok: true, cents: 1000 });
    expect(parseReceiveAmount("0,5", 200000)).toEqual({ ok: true, cents: 50 });
  });

  it("recusa formatos frouxos", () => {
    for (const input of ["1e3", "1-2", "1,2,3", "10,005", "-5", "1.2.3", "10.5.0"]) {
      expect(parseReceiveAmount(input, 10_000_000)).toEqual({ ok: false, error: "Informe o valor recebido." });
    }
  });

  it("aceita ponto como separador decimal com 1 ou 2 casas e sem vírgula", () => {
    expect(parseReceiveAmount("10.50", 200000)).toEqual({ ok: true, cents: 1050 });
    expect(parseReceiveAmount("20.50", 200000)).toEqual({ ok: true, cents: 2050 });
    expect(parseReceiveAmount("20.5", 200000)).toEqual({ ok: true, cents: 2050 });
    expect(parseReceiveAmount("100.5", 200000)).toEqual({ ok: true, cents: 10050 });
    expect(parseReceiveAmount("1.234", 200000)).toEqual({ ok: true, cents: 123400 });
    expect(parseReceiveAmount("1.234,56", 200000)).toEqual({ ok: true, cents: 123456 });
  });

  it("recusa zero", () => {
    expect(parseReceiveAmount("0", 200000)).toEqual({ ok: false, error: "Informe um valor maior que zero." });
  });
});

describe("planPreset", () => {
  const preset = (id: string, number: number, forecastPreset: SaleRow["forecastPreset"]): SaleRow => ({
    ...row(id, number, 100),
    forecastPreset,
  });

  it("usa o preset da parcela de maior número que não seja CUSTOM", () => {
    const rows = [preset("1", 1, "DAY_FIVE"), preset("3", 3, "CUSTOM"), preset("2", 2, "FIFTH_BUSINESS_DAY")];
    expect(planPreset(rows, "DAY_FIVE")).toBe("FIFTH_BUSINESS_DAY");
  });

  it("cai no preset da venda quando nenhuma parcela tem regra", () => {
    const rows = [preset("1", 1, null), preset("2", 2, "CUSTOM")];
    expect(planPreset(rows, "DAY_FIVE")).toBe("DAY_FIVE");
    expect(planPreset(rows, null)).toBeNull();
  });

  it("não reordena as linhas recebidas", () => {
    const rows = [preset("2", 2, "DAY_FIVE"), preset("1", 1, "FIFTH_BUSINESS_DAY")];
    planPreset(rows, null);
    expect(rows.map((r) => r.id)).toEqual(["2", "1"]);
  });
});

describe("allocationMatches", () => {
  const base = { fullIds: ["a"], untouchedIds: [] };

  it("aceita a mesma parcial e recusa qualquer diferença", () => {
    const allocation = { ...base, partial: { id: "b", paidCents: 4000, remainderCents: 3000 } };
    expect(allocationMatches(allocation, { partialId: "b", paidCents: 4000, remainderCents: 3000 })).toBe(true);
    expect(allocationMatches(allocation, { partialId: "c", paidCents: 4000, remainderCents: 3000 })).toBe(false);
    expect(allocationMatches(allocation, { partialId: "b", paidCents: 3000, remainderCents: 3000 })).toBe(false);
    expect(allocationMatches(allocation, { partialId: "b", paidCents: 4000, remainderCents: 2000 })).toBe(false);
    expect(allocationMatches(allocation, null)).toBe(false);
  });

  it("null exige alocação sem parcial", () => {
    expect(allocationMatches({ ...base, partial: null }, null)).toBe(true);
    expect(allocationMatches({ ...base, partial: null }, { partialId: "a", paidCents: 1, remainderCents: 1 })).toBe(false);
  });
});

describe("openRowsMatch", () => {
  const rows = [row("1", 1, 1000, null, noon(2026, 10, 1)), row("2", 2, 2000), row("3", 3, 3000)];

  it("aceita quando as abertas batem em id e valor", () => {
    expect(openRowsMatch(rows, [{ id: "2", amountCents: 2000 }, { id: "3", amountCents: 3000 }], [])).toBe(true);
  });

  it("recusa valor alterado, linha a mais ou a menos", () => {
    expect(openRowsMatch(rows, [{ id: "2", amountCents: 2000 }, { id: "3", amountCents: 2999 }], [])).toBe(false);
    expect(openRowsMatch(rows, [{ id: "2", amountCents: 2000 }], [])).toBe(false);
    expect(
      openRowsMatch(rows, [{ id: "1", amountCents: 1000 }, { id: "2", amountCents: 2000 }, { id: "3", amountCents: 3000 }], []),
    ).toBe(false);
  });

  it("ignora as linhas pedidas", () => {
    expect(openRowsMatch(rows, [{ id: "3", amountCents: 3000 }, { id: "9", amountCents: 1 }], ["2", "9"])).toBe(true);
  });
});
