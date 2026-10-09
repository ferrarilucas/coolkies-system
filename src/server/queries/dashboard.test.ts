import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace, backfillSaleInstallments } from "@/test/db";
import { seedParceledSale } from "@/test/sales";
import { scopedDb } from "@/server/tenant/extension";

const context = { workspaceId: "" };

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
}));

const { getDashboardData } = await import("./dashboard");

describe("getDashboardData — custo de produção + revenda combinados", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria Dashboard");
    context.workspaceId = workspace.id;
  });

  it("soma productionCogs e resaleCogs numa venda com os dois tipos de item, sem contagem dupla", async () => {
    const user = await testDb.user.create({
      data: { id: "u-dash", name: "Dona", email: "dona@example.com" },
    });

    const cookie = await testDb.item.create({
      data: {
        name: "Cookie Chocolate", unit: "UN", sellable: true, productionInput: false,
        workspaceId: context.workspaceId,
      },
    });
    const farinha = await testDb.item.create({
      data: {
        name: "Farinha", unit: "G", sellable: false, productionInput: true,
        workspaceId: context.workspaceId,
      },
    });
    const refri = await testDb.item.create({
      data: {
        name: "Refrigerante", unit: "UN", sellable: true, productionInput: false,
        workspaceId: context.workspaceId,
      },
    });

    const recipe = await testDb.recipe.create({
      data: { name: "Massa base", yieldQty: 10, workspaceId: context.workspaceId },
    });
    await testDb.recipeItem.create({
      data: { recipeId: recipe.id, itemId: farinha.id, quantity: 500, workspaceId: context.workspaceId },
    });

    const farinhaPurchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: {
        purchaseId: farinhaPurchase.id, itemId: farinha.id,
        quantity: 1000, unit: "G", pricePaidCents: 200, workspaceId: context.workspaceId,
      },
    });
    const refriPurchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: {
        purchaseId: refriPurchase.id, itemId: refri.id,
        quantity: 24, unit: "UN", pricePaidCents: 4800, workspaceId: context.workspaceId,
      },
    });

    await testDb.productionBatch.create({
      data: {
        itemId: cookie.id, recipeId: recipe.id, quantity: 10,
        userId: user.id, workspaceId: context.workspaceId,
      },
    });

    const soldAt = new Date("2026-09-15T12:00:00.000Z");
    await testDb.sale.create({
      data: {
        userId: user.id,
        workspaceId: context.workspaceId,
        status: "PAID",
        soldAt,
        paidAt: soldAt,
        totalCents: 2250,
        items: {
          create: [
            {
              itemId: cookie.id, quantity: 5, unitPriceSnapshot: 300,
              productNameSnapshot: "Cookie Chocolate", workspaceId: context.workspaceId,
            },
            {
              itemId: refri.id, quantity: 3, unitPriceSnapshot: 250,
              productNameSnapshot: "Refrigerante", workspaceId: context.workspaceId,
            },
          ],
        },
      },
    });

    await backfillSaleInstallments();
    const result = await getDashboardData({
      from: new Date("2026-09-01"),
      to: new Date("2026-09-30"),
      status: "ALL",
    });

    expect(result.kpis.soldUnits).toBe(8);
    expect(result.kpis.paidRevenueCents).toBe(2250);
    expect(result.kpis.productionCogsCents).toBe(50);
    expect(result.kpis.resaleCogsCents).toBe(600);
    expect(result.kpis.cogsCents).toBe(650);
    expect(result.kpis.netRevenueCents).toBe(1600);
    expect(result.kpis.presumedCogsCents).toBe(650);
    expect(result.kpis.presumedNetRevenueCents).toBe(1600);
  });

  it("receita líquida desconta só o custo das vendas pagas, não o das pendentes", async () => {
    const user = await testDb.user.create({
      data: { id: "u-dash-2", name: "Dona", email: "dona2@example.com" },
    });
    const refri = await testDb.item.create({
      data: {
        name: "Refrigerante", unit: "UN", sellable: true, productionInput: false,
        workspaceId: context.workspaceId,
      },
    });
    const purchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: {
        purchaseId: purchase.id, itemId: refri.id,
        quantity: 10, unit: "UN", pricePaidCents: 2000, workspaceId: context.workspaceId,
      },
    });

    const soldAt = new Date("2026-09-15T12:00:00.000Z");
    const line = (quantity: number) => ({
      itemId: refri.id, quantity, unitPriceSnapshot: 500,
      productNameSnapshot: "Refrigerante", workspaceId: context.workspaceId,
    });
    await testDb.sale.create({
      data: {
        userId: user.id, workspaceId: context.workspaceId, status: "PAID",
        soldAt, paidAt: soldAt, totalCents: 1000, items: { create: [line(2)] },
      },
    });
    await testDb.sale.create({
      data: {
        userId: user.id, workspaceId: context.workspaceId, status: "PENDING",
        soldAt, totalCents: 1500, items: { create: [line(3)] },
      },
    });

    await backfillSaleInstallments();
    const result = await getDashboardData({
      from: new Date("2026-09-01"),
      to: new Date("2026-09-30"),
      status: "ALL",
    });

    expect(result.kpis.soldUnits).toBe(5);
    expect(result.kpis.paidRevenueCents).toBe(1000);
    expect(result.kpis.forecastRevenueCents).toBe(1500);
    expect(result.kpis.resaleCogsCents).toBe(400);
    expect(result.kpis.cogsCents).toBe(400);
    expect(result.kpis.netRevenueCents).toBe(600);
    expect(result.kpis.marginPct).toBe(60);
    expect(result.kpis.totalRevenueCents).toBe(2500);
    expect(result.kpis.presumedCogsCents).toBe(1000);
    expect(result.kpis.presumedNetRevenueCents).toBe(1500);
    expect(result.kpis.presumedMarginPct).toBe(60);
  });

  it("sem custo cadastrado, presume custo zero: líquida igual à bruta e margem de 100%", async () => {
    const user = await testDb.user.create({
      data: { id: "u-dash-3", name: "Dona", email: "dona3@example.com" },
    });
    const cookie = await testDb.item.create({
      data: { name: "Cookie", unit: "UN", workspaceId: context.workspaceId },
    });
    const soldAt = new Date("2026-09-15T12:00:00.000Z");
    const line = (quantity: number) => ({
      itemId: cookie.id, quantity, unitPriceSnapshot: 1000,
      productNameSnapshot: "Cookie", workspaceId: context.workspaceId,
    });
    await testDb.sale.create({
      data: {
        userId: user.id, workspaceId: context.workspaceId, status: "PAID",
        soldAt, paidAt: soldAt, totalCents: 2000, items: { create: [line(2)] },
      },
    });
    await testDb.sale.create({
      data: {
        userId: user.id, workspaceId: context.workspaceId, status: "PENDING",
        soldAt, totalCents: 1000, items: { create: [line(1)] },
      },
    });

    await backfillSaleInstallments();
    const result = await getDashboardData({
      from: new Date("2026-09-01"),
      to: new Date("2026-09-30"),
      status: "ALL",
    });

    expect(result.kpis.cogsCents).toBe(0);
    expect(result.kpis.netRevenueCents).toBe(2000);
    expect(result.kpis.marginPct).toBe(100);
    expect(result.kpis.presumedNetRevenueCents).toBe(3000);
    expect(result.kpis.presumedMarginPct).toBe(100);
    expect(result.kpis.paidUncostedUnits).toBe(2);
    expect(result.kpis.uncostedUnits).toBe(3);
  });

  it("usa a ficha técnica da variação mesmo sem lote de produção registrado", async () => {
    const user = await testDb.user.create({
      data: { id: "u-dash-4", name: "Dona", email: "dona4@example.com" },
    });
    const cookie = await testDb.item.create({
      data: { name: "Cookie", unit: "UN", workspaceId: context.workspaceId },
    });
    const chocolate = await testDb.item.create({
      data: {
        name: "Chocolate", unit: "G", sellable: false, productionInput: true,
        workspaceId: context.workspaceId,
      },
    });
    const recipe = await testDb.recipe.create({
      data: { name: "Recheio", yieldQty: 1, workspaceId: context.workspaceId },
    });
    await testDb.recipeItem.create({
      data: { recipeId: recipe.id, itemId: chocolate.id, quantity: 20, workspaceId: context.workspaceId },
    });
    const variant = await testDb.variant.create({
      data: { name: "Chocolate", itemId: cookie.id, recipeId: recipe.id, workspaceId: context.workspaceId },
    });
    const purchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: {
        purchaseId: purchase.id, itemId: chocolate.id,
        quantity: 1000, unit: "G", pricePaidCents: 5000, workspaceId: context.workspaceId,
      },
    });

    const soldAt = new Date("2026-09-15T12:00:00.000Z");
    await testDb.sale.create({
      data: {
        userId: user.id, workspaceId: context.workspaceId, status: "PAID",
        soldAt, paidAt: soldAt, totalCents: 2000,
        items: {
          create: [{
            itemId: cookie.id, variantId: variant.id, quantity: 2, unitPriceSnapshot: 1000,
            productNameSnapshot: "Cookie", variantNameSnapshot: "Chocolate", workspaceId: context.workspaceId,
          }],
        },
      },
    });

    await backfillSaleInstallments();
    const result = await getDashboardData({
      from: new Date("2026-09-01"),
      to: new Date("2026-09-30"),
      status: "ALL",
    });

    expect(result.kpis.productionCogsCents).toBe(200);
    expect(result.kpis.netRevenueCents).toBe(1800);
    expect(result.kpis.marginPct).toBe(90);
    expect(result.kpis.paidUncostedUnits).toBe(0);
  });

  it("venda parcelada entra no realizado pela parcela paga e no previsto mês a mês", async () => {
    await seedParceledSale({
      workspaceId: context.workspaceId,
      soldAt: new Date(2027, 0, 10, 12),
      parcels: [
        { amountCents: 10000, dueDate: new Date(2027, 1, 5, 12), paidAt: new Date(2027, 1, 5, 12) },
        { amountCents: 10000, dueDate: new Date(2027, 2, 5, 12) },
        { amountCents: 10000, dueDate: new Date(2027, 3, 5, 12) },
      ],
    });

    const result = await getDashboardData({
      from: new Date(2027, 0, 1),
      to: new Date(2027, 5, 30),
      status: "ALL",
    });

    expect(result.kpis.paidRevenueCents).toBe(10000);
    expect(result.kpis.forecastRevenueCents).toBe(20000);
    expect(result.trend.map((b) => [b.realizada, b.prevista])).toEqual([
      [0, 0],
      [100, 0],
      [0, 100],
      [0, 100],
      [0, 0],
      [0, 0],
    ]);
  });
  it("venda parcelada com uma parcela paga e item sem custo devolve unidades inteiras", async () => {
    const cookie = await testDb.item.create({
      data: { name: "Cookie", unit: "UN", workspaceId: context.workspaceId },
    });
    const sale = await seedParceledSale({
      workspaceId: context.workspaceId,
      soldAt: new Date(2027, 0, 10, 12),
      parcels: [
        { amountCents: 1000, dueDate: new Date(2027, 0, 10, 12), paidAt: new Date(2027, 0, 10, 12) },
        { amountCents: 1000, dueDate: new Date(2027, 1, 10, 12) },
        { amountCents: 1000, dueDate: new Date(2027, 2, 10, 12) },
      ],
    });
    await testDb.saleItem.create({
      data: {
        saleId: sale.id, itemId: cookie.id, quantity: 5, unitPriceSnapshot: 600,
        productNameSnapshot: "Cookie", workspaceId: context.workspaceId,
      },
    });

    const result = await getDashboardData({
      from: new Date(2027, 0, 1),
      to: new Date(2027, 0, 31),
      status: "ALL",
    });

    expect(result.kpis.paidRevenueCents).toBe(1000);
    expect(Number.isInteger(result.kpis.paidUncostedUnits)).toBe(true);
    expect(Number.isInteger(result.kpis.uncostedUnits)).toBe(true);
    expect(Number.isInteger(result.kpis.soldUnits)).toBe(true);
    expect(result.kpis.paidUncostedUnits).toBe(2);
    expect(result.kpis.uncostedUnits).toBe(5);
    expect(result.kpis.soldUnits).toBe(5);
  });

  it("parcela paga dentro do período entra no realizado mesmo com a venda feita antes", async () => {
    await seedParceledSale({
      workspaceId: context.workspaceId,
      soldAt: new Date(2026, 9, 10, 12),
      parcels: [
        { amountCents: 10000, dueDate: new Date(2026, 10, 5, 12), paidAt: new Date(2026, 10, 5, 12) },
        { amountCents: 10000, dueDate: new Date(2027, 0, 5, 12), paidAt: new Date(2027, 0, 7, 12) },
        { amountCents: 10000, dueDate: new Date(2027, 0, 20, 12) },
      ],
    });

    const result = await getDashboardData({
      from: new Date(2027, 0, 1),
      to: new Date(2027, 0, 31),
      status: "ALL",
    });

    expect(result.kpis.salesCount).toBe(0);
    const byLabel = new Map(result.trend.map((b) => [b.label, b]));
    expect(byLabel.get("07/01")).toEqual({ label: "07/01", realizada: 100, prevista: 0 });
    expect(byLabel.get("20/01")).toEqual({ label: "20/01", realizada: 0, prevista: 100 });
    expect(result.trend.reduce((s, b) => s + b.realizada, 0)).toBe(100);
    expect(result.trend.reduce((s, b) => s + b.prevista, 0)).toBe(100);
  });

  it("parcelas que vencem fora do período não aparecem na série", async () => {
    await seedParceledSale({
      workspaceId: context.workspaceId,
      soldAt: new Date(2027, 0, 10, 12),
      parcels: [
        { amountCents: 10000, dueDate: new Date(2027, 1, 5, 12) },
        { amountCents: 10000, dueDate: new Date(2027, 2, 5, 12) },
        { amountCents: 10000, dueDate: new Date(2027, 3, 5, 12) },
      ],
    });

    const result = await getDashboardData({
      from: new Date(2027, 0, 1),
      to: new Date(2027, 0, 31),
      status: "ALL",
    });

    expect(result.kpis.forecastRevenueCents).toBe(30000);
    expect(result.trend.every((b) => b.realizada === 0 && b.prevista === 0)).toBe(true);
  });
});
