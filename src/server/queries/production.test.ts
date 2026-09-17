import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

const context = { workspaceId: "" };

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
}));

const { getItemStock } = await import("./production");

beforeEach(async () => {
  await resetDb();
});

describe("getItemStock", () => {
  it("soma StockMovement por item sem variante", async () => {
    const ws = await createWorkspace("Loja A");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({
      data: { name: "Açúcar", workspaceId: ws.id, unit: "G", productionInput: true, sellable: false, minStock: 500 },
    });
    await testDb.stockMovement.create({
      data: { itemId: item.id, type: "PURCHASE", quantity: 1000, workspaceId: ws.id },
    });
    await testDb.stockMovement.create({
      data: { itemId: item.id, type: "CONSUMPTION", quantity: -300, workspaceId: ws.id },
    });

    const stock = await getItemStock();

    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({
      itemId: item.id,
      current: 700,
      belowMin: false,
      variantId: null,
    });
  });

  it("agrupa por variante quando o item tem variantes", async () => {
    const ws = await createWorkspace("Loja B");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({
      data: { name: "Cookie", workspaceId: ws.id, sellable: true, unit: "UN" },
    });
    const choc = await testDb.variant.create({ data: { name: "Chocolate", itemId: item.id, workspaceId: ws.id } });
    const trad = await testDb.variant.create({ data: { name: "Tradicional", itemId: item.id, workspaceId: ws.id } });
    await testDb.stockMovement.create({ data: { itemId: item.id, variantId: choc.id, type: "PRODUCTION", quantity: 10, workspaceId: ws.id } });
    await testDb.stockMovement.create({ data: { itemId: item.id, variantId: choc.id, type: "SALE", quantity: -3, workspaceId: ws.id } });
    await testDb.stockMovement.create({ data: { itemId: item.id, variantId: trad.id, type: "PRODUCTION", quantity: 5, workspaceId: ws.id } });

    const stock = await getItemStock();

    expect(stock).toHaveLength(2);
    const chocEntry = stock.find((s) => s.variantId === choc.id);
    const tradEntry = stock.find((s) => s.variantId === trad.id);
    expect(chocEntry?.current).toBe(7);
    expect(tradEntry?.current).toBe(5);
  });

  it("marca belowMin quando o saldo fica abaixo do mínimo", async () => {
    const ws = await createWorkspace("Loja C");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({
      data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, minStock: 1000 },
    });
    await testDb.stockMovement.create({ data: { itemId: item.id, type: "PURCHASE", quantity: 500, workspaceId: ws.id } });

    const stock = await getItemStock();
    expect(stock[0].belowMin).toBe(true);
  });
});
