import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "u1", canWrite: true };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({
    db: scopedDb(context.workspaceId),
    workspaceId: context.workspaceId,
    userId: context.userId,
    role: "OWNER",
    canWrite: context.canWrite,
  }),
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
  assertCanWrite: async () => {
    if (!context.canWrite) throw new Error("Este workspace está em modo somente leitura.");
  },
}));

const { createProductionBatch, updateProductionBatch, deleteProductionBatch } = await import("./production");
const { getItemStock } = await import("@/server/queries/production");

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(async () => {
  await resetDb();
  context.canWrite = true;
  await testDb.user.create({
    data: { id: context.userId, name: "Usuário Teste", email: "u1@example.com" },
  });
});

describe("createProductionBatch", () => {
  it("grava StockMovement(PRODUCTION) para item sem variante e sem receita", async () => {
    const ws = await createWorkspace("Loja A");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Vela", workspaceId: ws.id, sellable: true, unit: "UN" } });

    const res = await createProductionBatch(fd({ itemId: item.id, quantity: "10", producedAt: "2026-09-16" }));
    expect(res.ok).toBe(true);

    const stock = await getItemStock();
    expect(stock.find((s) => s.itemId === item.id)?.current).toBe(10);
  });

  it("grava CONSUMPTION dos insumos da receita proporcional à quantidade produzida", async () => {
    const ws = await createWorkspace("Loja B");
    context.workspaceId = ws.id;
    const flour = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true } });
    const output = await testDb.item.create({ data: { name: "Pão", workspaceId: ws.id, sellable: true, unit: "UN" } });
    const recipe = await testDb.recipe.create({
      data: { name: "Pão base", yieldQty: 2, workspaceId: ws.id, items: { create: [{ itemId: flour.id, quantity: 100, workspaceId: ws.id }] } },
    });
    await testDb.stockMovement.create({ data: { itemId: flour.id, type: "PURCHASE", quantity: 1000, workspaceId: ws.id } });

    const res = await createProductionBatch(fd({ itemId: output.id, recipeId: recipe.id, quantity: "6", producedAt: "2026-09-16" }));
    expect(res.ok).toBe(true);

    const stock = await getItemStock();
    expect(stock.find((s) => s.itemId === flour.id)?.current).toBe(700);
    expect(stock.find((s) => s.itemId === output.id)?.current).toBe(6);
  });

  it("distribui entre variantes e grava um StockMovement por variante", async () => {
    const ws = await createWorkspace("Loja C");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Cookie", workspaceId: ws.id, sellable: true, unit: "UN" } });
    const choc = await testDb.variant.create({ data: { name: "Chocolate", itemId: item.id, workspaceId: ws.id } });
    const trad = await testDb.variant.create({ data: { name: "Tradicional", itemId: item.id, workspaceId: ws.id } });

    const res = await createProductionBatch(fd({
      itemId: item.id,
      quantity: "10",
      producedAt: "2026-09-16",
      variantLines: JSON.stringify([{ variantId: choc.id, quantity: 6 }, { variantId: trad.id, quantity: 4 }]),
    }));
    expect(res.ok).toBe(true);

    const stock = await getItemStock();
    expect(stock.find((s) => s.variantId === choc.id)?.current).toBe(6);
    expect(stock.find((s) => s.variantId === trad.id)?.current).toBe(4);
  });
});

describe("updateProductionBatch", () => {
  it("substitui (não duplica) StockMovement e ProductionVariantLine ao mudar quantidade e variantes", async () => {
    const ws = await createWorkspace("Loja E");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Cookie", workspaceId: ws.id, sellable: true, unit: "UN" } });
    const choc = await testDb.variant.create({ data: { name: "Chocolate", itemId: item.id, workspaceId: ws.id } });
    const trad = await testDb.variant.create({ data: { name: "Tradicional", itemId: item.id, workspaceId: ws.id } });

    await createProductionBatch(fd({
      itemId: item.id,
      quantity: "10",
      producedAt: "2026-09-16",
      variantLines: JSON.stringify([{ variantId: choc.id, quantity: 6 }, { variantId: trad.id, quantity: 4 }]),
    }));
    const batch = await testDb.productionBatch.findFirstOrThrow({ where: { itemId: item.id } });

    const res = await updateProductionBatch(batch.id, fd({
      itemId: item.id,
      quantity: "12",
      producedAt: "2026-09-17",
      variantLines: JSON.stringify([{ variantId: choc.id, quantity: 5 }, { variantId: trad.id, quantity: 7 }]),
    }));
    expect(res.ok).toBe(true);

    const movements = await testDb.stockMovement.findMany({ where: { productionBatchId: batch.id } });
    expect(movements).toHaveLength(2);
    const lines = await testDb.productionVariantLine.findMany({ where: { productionBatchId: batch.id } });
    expect(lines).toHaveLength(2);

    const stock = await getItemStock();
    expect(stock.find((s) => s.variantId === choc.id)?.current).toBe(5);
    expect(stock.find((s) => s.variantId === trad.id)?.current).toBe(7);

    const updated = await testDb.productionBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updated.quantity).toBe(12);
  });

  it("recalcula o CONSUMPTION da receita ao mudar a quantidade produzida", async () => {
    const ws = await createWorkspace("Loja F");
    context.workspaceId = ws.id;
    const flour = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true } });
    const output = await testDb.item.create({ data: { name: "Pão", workspaceId: ws.id, sellable: true, unit: "UN" } });
    const recipe = await testDb.recipe.create({
      data: { name: "Pão base", yieldQty: 2, workspaceId: ws.id, items: { create: [{ itemId: flour.id, quantity: 100, workspaceId: ws.id }] } },
    });
    await testDb.stockMovement.create({ data: { itemId: flour.id, type: "PURCHASE", quantity: 1000, workspaceId: ws.id } });

    await createProductionBatch(fd({ itemId: output.id, recipeId: recipe.id, quantity: "6", producedAt: "2026-09-16" }));
    const batch = await testDb.productionBatch.findFirstOrThrow({ where: { itemId: output.id } });

    const res = await updateProductionBatch(batch.id, fd({
      itemId: output.id,
      recipeId: recipe.id,
      quantity: "4",
      producedAt: "2026-09-16",
    }));
    expect(res.ok).toBe(true);

    const consumption = await testDb.stockMovement.findMany({
      where: { productionBatchId: batch.id, type: "CONSUMPTION" },
    });
    expect(consumption).toHaveLength(1);
    expect(consumption[0].quantity).toBe(-200);

    const stock = await getItemStock();
    expect(stock.find((s) => s.itemId === flour.id)?.current).toBe(800);
    expect(stock.find((s) => s.itemId === output.id)?.current).toBe(4);
  });
});

describe("deleteProductionBatch", () => {
  it("remove os StockMovement associados ao excluir o lote", async () => {
    const ws = await createWorkspace("Loja D");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Vela", workspaceId: ws.id, sellable: true, unit: "UN" } });
    await createProductionBatch(fd({ itemId: item.id, quantity: "10", producedAt: "2026-09-16" }));
    const batch = await testDb.productionBatch.findFirstOrThrow({ where: { itemId: item.id } });

    await deleteProductionBatch(batch.id);

    const stock = await getItemStock();
    expect(stock.find((s) => s.itemId === item.id)?.current).toBe(0);
  });
});
