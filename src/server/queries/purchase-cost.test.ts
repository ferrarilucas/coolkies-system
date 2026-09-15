import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { unitCostFromLastPurchase, getLastPurchase } from "./purchase-cost";

describe("unitCostFromLastPurchase", () => {
  it("divide preço pago pela quantidade", () => {
    expect(unitCostFromLastPurchase({ quantity: 1000, pricePaidCents: 250 })).toBe(0.25);
  });

  it("retorna null sem compra", () => {
    expect(unitCostFromLastPurchase(null)).toBeNull();
  });

  it("retorna null com quantidade zero", () => {
    expect(unitCostFromLastPurchase({ quantity: 0, pricePaidCents: 250 })).toBeNull();
  });
});

describe("getLastPurchase", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("retorna null quando o insumo nunca foi comprado", async () => {
    const workspace = await createWorkspace("Confeitaria");
    const ingredient = await testDb.ingredient.create({
      data: { name: "Açúcar", baseUnit: "G", workspaceId: workspace.id },
    });

    const result = await getLastPurchase(testDb, ingredient.id);
    expect(result).toBeNull();
  });

  it("retorna a compra mais recente entre todos os fornecedores", async () => {
    const workspace = await createWorkspace("Confeitaria 2");
    const ingredient = await testDb.ingredient.create({
      data: { name: "Farinha", baseUnit: "G", workspaceId: workspace.id },
    });
    const supplierA = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    const supplierB = await testDb.supplier.create({
      data: { name: "Sam's Club", workspaceId: workspace.id },
    });

    const older = await testDb.purchase.create({
      data: { supplierId: supplierA.id, purchasedAt: new Date("2026-01-01"), workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: older.id, ingredientId: ingredient.id, quantity: 1000, unit: "G", pricePaidCents: 400, workspaceId: workspace.id },
    });

    const newer = await testDb.purchase.create({
      data: { supplierId: supplierB.id, purchasedAt: new Date("2026-02-01"), workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: newer.id, ingredientId: ingredient.id, quantity: 500, unit: "G", pricePaidCents: 300, workspaceId: workspace.id },
    });

    const result = await getLastPurchase(testDb, ingredient.id);
    expect(result).toMatchObject({ quantity: 500, pricePaidCents: 300, supplierId: supplierB.id });
  });

  it("filtra pela compra mais recente de um fornecedor específico", async () => {
    const workspace = await createWorkspace("Confeitaria 3");
    const ingredient = await testDb.ingredient.create({
      data: { name: "Ovos", baseUnit: "UN", workspaceId: workspace.id },
    });
    const supplierA = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    const supplierB = await testDb.supplier.create({
      data: { name: "Sam's Club", workspaceId: workspace.id },
    });

    const purchaseA = await testDb.purchase.create({
      data: { supplierId: supplierA.id, purchasedAt: new Date("2026-01-01"), workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchaseA.id, ingredientId: ingredient.id, quantity: 12, unit: "UN", pricePaidCents: 1200, workspaceId: workspace.id },
    });

    const purchaseB = await testDb.purchase.create({
      data: { supplierId: supplierB.id, purchasedAt: new Date("2026-02-01"), workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchaseB.id, ingredientId: ingredient.id, quantity: 30, unit: "UN", pricePaidCents: 3600, workspaceId: workspace.id },
    });

    const result = await getLastPurchase(testDb, ingredient.id, supplierA.id);
    expect(result).toMatchObject({ quantity: 12, pricePaidCents: 1200, supplierId: supplierA.id });
  });
});
