import { describe, expect, it } from "vitest";
import type { ChargeSelection } from "@/server/queries/charge-selection";
import {
  CHARGE_IMAGE_MAX_HEIGHT,
  CHARGE_IMAGE_MAX_INSTALLMENTS,
  CHARGE_IMAGE_MAX_ITEMS,
  buildChargeImageModel,
  estimateLines,
} from "./layout";

type Sale = ChargeSelection["sales"][number];

function sale(n: number, items: number, parcels: number, name = "Cookie"): Sale {
  return {
    id: `s${n}`,
    soldAt: new Date(Date.UTC(2026, 9, 1 + (n % 28), 15)),
    totalCents: 10000,
    installmentCount: Math.max(parcels, 2),
    items: Array.from({ length: items }, (_, i) => ({
      id: `s${n}i${i}`,
      quantity: 1,
      productNameSnapshot: name,
      variantNameSnapshot: null,
    })),
    selectedInstallments: Array.from({ length: parcels }, (_, i) => ({
      id: `s${n}p${i}`,
      number: i + 1,
      amountCents: 1000,
      dueDate: null,
    })),
  };
}

function selection(sales: Sale[]): ChargeSelection {
  return {
    customer: { id: "c", name: "MARIA WWWWWW MMMMMMM DA SILVA SAUROS", sector: "ADMINISTRAÇÃO MWMW" },
    sales,
    totalCents: sales.reduce((sum, s) => sum + s.selectedInstallments.reduce((a, i) => a + i.amountCents, 0), 0),
  };
}

const base = { workspaceName: "Cipri", pixKey: "ana@cipri.com.br", generatedAt: new Date(Date.UTC(2026, 10, 4, 15)) };

describe("estimateLines", () => {
  it("texto largo ocupa mais linhas que estreito com o mesmo tamanho", () => {
    expect(estimateLines("i".repeat(60), 24, 900, 9)).toBe(1);
    expect(estimateLines("W".repeat(60), 24, 900, 9)).toBeGreaterThan(1);
  });

  it("respeita o teto de linhas", () => {
    expect(estimateLines("MWMW ".repeat(200), 24, 900, 2)).toBe(2);
  });

  it("palavra maior que a linha quebra por caractere", () => {
    expect(estimateLines("x".repeat(200), 20, 300, 99)).toBeGreaterThan(5);
  });
});

describe("buildChargeImageModel", () => {
  it("não mostra nome nem setor do cliente", () => {
    const model = buildChargeImageModel({ ...base, selection: selection([sale(1, 1, 1)]) });
    expect(JSON.stringify(model)).not.toMatch(/MARIA|ADMINISTRA/);
  });

  it("limita itens e parcelas por venda e conta o excedente", () => {
    const model = buildChargeImageModel({ ...base, selection: selection([sale(1, 9, 8)]) });
    expect(model.sales[0].items).toHaveLength(CHARGE_IMAGE_MAX_ITEMS);
    expect(model.sales[0].hiddenItems).toBe(3);
    expect(model.sales[0].installments).toHaveLength(CHARGE_IMAGE_MAX_INSTALLMENTS);
    expect(model.sales[0].hiddenInstallments).toBe(2);
  });

  it("venda à vista não lista parcelas", () => {
    const single = { ...sale(1, 1, 1), installmentCount: 1 };
    const model = buildChargeImageModel({ ...base, selection: selection([single]) });
    expect(model.sales[0].installments).toEqual([]);
    expect(model.sales[0].hiddenInstallments).toBe(0);
  });

  it("orçamento de altura: vendas que não cabem viram + N vendas e o total é de todas", () => {
    const sales = Array.from({ length: 200 }, (_, i) => sale(i, 6, 1, "COOKIE MWMWMWMW ".repeat(8)));
    const model = buildChargeImageModel({ ...base, selection: selection(sales) });
    expect(model.height).toBeLessThanOrEqual(CHARGE_IMAGE_MAX_HEIGHT);
    expect(model.sales.length).toBeGreaterThan(0);
    expect(model.sales.length + model.hiddenSales).toBe(200);
    expect(model.hiddenSales).toBeGreaterThan(0);
    expect(model.total).toBe("R$ 2.000,00");
  });

  it("poucas vendas cabem inteiras", () => {
    const model = buildChargeImageModel({ ...base, selection: selection([sale(1, 2, 1), sale(2, 1, 1)]) });
    expect(model.hiddenSales).toBe(0);
    expect(model.sales).toHaveLength(2);
  });

  it("sanitiza textos e chave Pix", () => {
    const withEmoji = { ...sale(1, 1, 1), items: [{ id: "i", quantity: 2, productNameSnapshot: "Cookie 🍪", variantNameSnapshot: "Łódź" }] };
    const model = buildChargeImageModel({
      ...base,
      workspaceName: "Doceria 🍰 São João",
      pixKey: "  ",
      selection: selection([withEmoji]),
    });
    expect(model.workspaceName).toBe("Doceria São João");
    expect(model.sales[0].items[0].label).toBe("2x Cookie — Łódź");
    expect(model.pixKey).toBeNull();
    expect(model.pixKeyLines).toBe(0);
  });

  it("chave Pix longa usa até 2 linhas e a altura acompanha", () => {
    const short = buildChargeImageModel({ ...base, selection: selection([sale(1, 1, 1)]) });
    const long = buildChargeImageModel({
      ...base,
      pixKey: "maria.wwwwwwmmmmmmm.dasilva.sauros.administracao@empresa-muito-longa.com.br",
      selection: selection([sale(1, 1, 1)]),
    });
    expect(short.pixKeyLines).toBe(1);
    expect(long.pixKeyLines).toBe(2);
    expect(long.height).toBeGreaterThan(short.height);
  });
});
