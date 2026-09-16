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

    const cookieProduct = await testDb.product.create({
      data: { name: "Cookie Chocolate", workspaceId: context.workspaceId },
    });
    const refriProduct = await testDb.product.create({
      data: { name: "Refrigerante", workspaceId: context.workspaceId },
    });

    const farinha = await testDb.ingredient.create({
      data: { name: "Farinha", baseUnit: "G", workspaceId: context.workspaceId },
    });
    const refri = await testDb.ingredient.create({
      data: {
        name: "Refrigerante", baseUnit: "UN", isRawMaterial: false, forResale: true,
        resaleProductId: refriProduct.id, workspaceId: context.workspaceId,
      },
    });

    const recipe = await testDb.recipe.create({
      data: { name: "Massa base", yieldQty: 10, workspaceId: context.workspaceId },
    });
    await testDb.recipeIngredient.create({
      data: { recipeId: recipe.id, ingredientId: farinha.id, quantity: 500, workspaceId: context.workspaceId },
    });

    const farinhaPurchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: {
        purchaseId: farinhaPurchase.id, ingredientId: farinha.id,
        quantity: 1000, unit: "G", pricePaidCents: 200, workspaceId: context.workspaceId,
      },
    });
    const refriPurchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: {
        purchaseId: refriPurchase.id, ingredientId: refri.id,
        quantity: 24, unit: "UN", pricePaidCents: 4800, workspaceId: context.workspaceId,
      },
    });

    await testDb.productionBatch.create({
      data: {
        productId: cookieProduct.id, recipeId: recipe.id, quantity: 10,
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
              productId: cookieProduct.id, quantity: 5, unitPriceSnapshot: 300,
              productNameSnapshot: "Cookie Chocolate", workspaceId: context.workspaceId,
            },
            {
              productId: refriProduct.id, quantity: 3, unitPriceSnapshot: 250,
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

    expect(result.kpis.soldCookies).toBe(5);
    expect(result.kpis.paidRevenueCents).toBe(2250);
    // productionCogs = 10 cents/cookie * 5 cookies = 50; resaleCogs = 200 cents/un * 3 un = 600
    expect(result.kpis.cogsCents).toBe(650);
    expect(result.kpis.grossProfitCents).toBe(1600);
  });
});
