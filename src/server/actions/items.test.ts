import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "", canWrite: true };

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

const { createItem, updateItem, createItemForPurchase, deleteItem } = await import("./items");

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("createItem", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria item só de insumo de produção", async () => {
    const res = await createItem(
      fd({ name: "Açúcar", unit: "G", productionInput: "on" }),
    );
    expect(res.ok).toBe(true);

    const item = await testDb.item.findFirstOrThrow({ where: { name: "Açúcar" } });
    expect(item.productionInput).toBe(true);
    expect(item.sellable).toBe(false);
  });

  it("cria item vendável", async () => {
    const res = await createItem(
      fd({ name: "Refrigerante", unit: "UN", sellable: "on" }),
    );
    expect(res.ok).toBe(true);

    const item = await testDb.item.findFirstOrThrow({ where: { name: "Refrigerante" } });
    expect(item.sellable).toBe(true);
  });

  it("recusa item sem nenhuma finalidade marcada", async () => {
    const res = await createItem(fd({ name: "Sem finalidade", unit: "G" }));
    expect(res.ok).toBe(false);
  });

  it("permite marcar productionInput e sellable ao mesmo tempo no mesmo item", async () => {
    const ws = await createWorkspace("Loja A");
    context.workspaceId = ws.id;
    const fdata = new FormData();
    fdata.set("name", "Açúcar embalado");
    fdata.set("unit", "UN");
    fdata.set("productionInput", "on");
    fdata.set("sellable", "on");

    const res = await createItem(fdata);
    expect(res.ok).toBe(true);

    const item = await testDb.item.findFirstOrThrow({ where: { name: "Açúcar embalado" } });
    expect(item.productionInput).toBe(true);
    expect(item.sellable).toBe(true);
  });

  it("rejeita sellable com unidade diferente de UN", async () => {
    const ws = await createWorkspace("Loja B");
    context.workspaceId = ws.id;
    const fdata = new FormData();
    fdata.set("name", "Farinha a granel");
    fdata.set("unit", "G");
    fdata.set("sellable", "on");

    const res = await createItem(fdata);
    expect(res.ok).toBe(false);
  });
});

describe("updateItem", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 2");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("atualiza as flags do item", async () => {
    await createItem(fd({ name: "Suco", unit: "UN", productionInput: "on" }));
    const item = await testDb.item.findFirstOrThrow({ where: { name: "Suco" } });
    expect(item.sellable).toBe(false);

    await updateItem(item.id, fd({ name: "Suco", unit: "UN", productionInput: "on", sellable: "on" }));

    const updated = await testDb.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.sellable).toBe(true);
  });

  it("rejeita atualização que deixa sellable com unidade diferente de UN", async () => {
    await createItem(fd({ name: "Leite", unit: "UN", sellable: "on" }));
    const item = await testDb.item.findFirstOrThrow({ where: { name: "Leite" } });

    const res = await updateItem(item.id, fd({ name: "Leite", unit: "ML", sellable: "on" }));
    expect(res.ok).toBe(false);
  });
});

describe("createItemForPurchase", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 3");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria item vendável direto do fluxo de compra", async () => {
    const res = await createItemForPurchase(
      fd({ name: "Chocolate quente", unit: "UN", sellable: "on" }),
    );
    expect(res.ok).toBe(true);
    expect(res.data?.sellable).toBe(true);

    const item = await testDb.item.findFirstOrThrow({ where: { name: "Chocolate quente" } });
    expect(item.sellable).toBe(true);
  });

  it("rejeita item de compra vendável com unidade diferente de UN", async () => {
    const res = await createItemForPurchase(
      fd({ name: "Farinha granel", unit: "G", sellable: "on" }),
    );
    expect(res.ok).toBe(false);
  });
});

describe("deleteItem", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 4");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("deleta item com sucesso", async () => {
    await createItem(fd({ name: "Farinha", unit: "G", productionInput: "on" }));
    const item = await testDb.item.findFirstOrThrow({ where: { name: "Farinha" } });

    const res = await deleteItem(item.id);
    expect(res.ok).toBe(true);

    const deletedItem = await testDb.item.findUnique({ where: { id: item.id } });
    expect(deletedItem).toBeNull();
  });

  it("rejeita exclusão quando item está vinculado a uma receita", async () => {
    await createItem(fd({ name: "Açúcar", unit: "G", productionInput: "on" }));
    const item = await testDb.item.findFirstOrThrow({ where: { name: "Açúcar" } });

    await testDb.recipe.create({
      data: {
        name: "Bolo de Chocolate",
        workspaceId: context.workspaceId,
      },
    });
    const recipe = await testDb.recipe.findFirstOrThrow({ where: { name: "Bolo de Chocolate" } });

    await testDb.recipeItem.create({
      data: {
        recipeId: recipe.id,
        itemId: item.id,
        quantity: 100,
        workspaceId: context.workspaceId,
      },
    });

    const res = await deleteItem(item.id);
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();

    const stillExists = await testDb.item.findUnique({ where: { id: item.id } });
    expect(stillExists).not.toBeNull();
  });
});
