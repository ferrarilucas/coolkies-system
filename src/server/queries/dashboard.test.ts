import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
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
});
