import { describe, expect, it } from "vitest";
import {
  buildCustomerBalances,
  parseForecastCutoff,
  type CustomerPendingRow,
} from "./customer-balance";

const NOW = new Date("2026-08-30T12:00:00Z");

const ana = { id: "ana", name: "Ana" };
const bru = { id: "bru", name: "Bruno" };

function row(over: Partial<CustomerPendingRow> & { customerId: string }): CustomerPendingRow {
  return {
    pendingCents: 0,
    pendingCount: 0,
    oldestForecastDate: null,
    ...over,
  };
}

describe("buildCustomerBalances", () => {
  it("anexa saldo e contagem de pendências ao cliente", () => {
    const result = buildCustomerBalances(
      [ana],
      [row({ customerId: "ana", pendingCents: 15000, pendingCount: 3 })],
      { situation: "all" },
      NOW,
    );

    expect(result).toEqual([
      { ...ana, pendingCents: 15000, pendingCount: 3, isOverdue: false },
    ]);
  });

  it("zera o saldo de quem não tem venda pendente", () => {
    const result = buildCustomerBalances([bru], [], { situation: "all" }, NOW);

    expect(result[0].pendingCents).toBe(0);
    expect(result[0].pendingCount).toBe(0);
  });

  it("marca em atraso quando a previsão mais antiga já venceu", () => {
    const result = buildCustomerBalances(
      [ana],
      [
        row({
          customerId: "ana",
          pendingCents: 500,
          pendingCount: 1,
          oldestForecastDate: new Date("2026-08-29T00:00:00Z"),
        }),
      ],
      { situation: "all" },
      NOW,
    );

    expect(result[0].isOverdue).toBe(true);
  });

  it("não marca em atraso quando a previsão ainda não chegou", () => {
    const result = buildCustomerBalances(
      [ana],
      [
        row({
          customerId: "ana",
          pendingCents: 500,
          pendingCount: 1,
          oldestForecastDate: new Date("2026-09-05T00:00:00Z"),
        }),
      ],
      { situation: "all" },
      NOW,
    );

    expect(result[0].isOverdue).toBe(false);
  });

  it("não marca em atraso pendência sem previsão de pagamento", () => {
    const result = buildCustomerBalances(
      [ana],
      [row({ customerId: "ana", pendingCents: 500, pendingCount: 1 })],
      { situation: "all" },
      NOW,
    );

    expect(result[0].isOverdue).toBe(false);
  });

  it("situação 'pending' mantém apenas quem deve", () => {
    const result = buildCustomerBalances(
      [ana, bru],
      [row({ customerId: "ana", pendingCents: 500, pendingCount: 1 })],
      { situation: "pending" },
      NOW,
    );

    expect(result.map((c) => c.id)).toEqual(["ana"]);
  });

  it("situação 'overdue' mantém apenas quem está em atraso", () => {
    const result = buildCustomerBalances(
      [ana, bru],
      [
        row({ customerId: "ana", pendingCents: 500, pendingCount: 1 }),
        row({
          customerId: "bru",
          pendingCents: 900,
          pendingCount: 1,
          oldestForecastDate: new Date("2026-08-01T00:00:00Z"),
        }),
      ],
      { situation: "overdue" },
      NOW,
    );

    expect(result.map((c) => c.id)).toEqual(["bru"]);
  });

  it("situação 'clear' mantém apenas quem não deve nada", () => {
    const result = buildCustomerBalances(
      [ana, bru],
      [row({ customerId: "ana", pendingCents: 500, pendingCount: 1 })],
      { situation: "clear" },
      NOW,
    );

    expect(result.map((c) => c.id)).toEqual(["bru"]);
  });

  it("valor mínimo devido descarta quem deve menos, incluindo o limite exato", () => {
    const result = buildCustomerBalances(
      [ana, bru],
      [
        row({ customerId: "ana", pendingCents: 10000, pendingCount: 1 }),
        row({ customerId: "bru", pendingCents: 9999, pendingCount: 1 }),
      ],
      { situation: "all", minDueCents: 10000 },
      NOW,
    );

    expect(result.map((c) => c.id)).toEqual(["ana"]);
  });

  it("valor mínimo devido não se aplica à situação 'clear'", () => {
    const result = buildCustomerBalances(
      [bru],
      [],
      { situation: "clear", minDueCents: 10000 },
      NOW,
    );

    expect(result.map((c) => c.id)).toEqual(["bru"]);
  });
});

describe("parseForecastCutoff", () => {
  it("leva a data para o fim do dia local", () => {
    const cutoff = parseForecastCutoff("2026-09-04");
    expect(cutoff).toEqual(new Date("2026-09-04T23:59:59.999"));
  });

  it("ignora entrada vazia ou fora do formato", () => {
    expect(parseForecastCutoff()).toBeUndefined();
    expect(parseForecastCutoff("")).toBeUndefined();
    expect(parseForecastCutoff("  ")).toBeUndefined();
    expect(parseForecastCutoff("04/09/2026")).toBeUndefined();
    expect(parseForecastCutoff("2026-13-45")).toBeUndefined();
  });
});
