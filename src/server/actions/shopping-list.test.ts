import { describe, it, expect, beforeEach, vi } from "vitest";
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

const { createShoppingListItem, deleteShoppingListItem, toggleShoppingListItem, addSuggestedItem } = await import("./shopping-list");
const { getShoppingListItems, getShoppingListSuggestions } = await import("@/server/queries/shopping-list");

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(async () => {
  await resetDb();
  context.canWrite = true;
});

describe("createShoppingListItem", () => {
  it("cria um item de texto livre, sem vínculo com Item cadastrado", async () => {
    const ws = await createWorkspace("Loja A");
    context.workspaceId = ws.id;
    const res = await createShoppingListItem(fd({ label: "Café de casa" }));
    expect(res.ok).toBe(true);

    const items = await getShoppingListItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: "Café de casa", itemId: null });
  });

  it("cria um item vinculado a um Item cadastrado, com quantidade/unidade", async () => {
    const ws = await createWorkspace("Loja B");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Açúcar", workspaceId: ws.id, unit: "G", productionInput: true } });

    const res = await createShoppingListItem(fd({ itemId: item.id, label: "Açúcar", quantity: "500", unit: "G" }));
    expect(res.ok).toBe(true);

    const items = await getShoppingListItems();
    expect(items[0]).toMatchObject({ itemId: item.id, quantity: 500, unit: "G" });
  });
});

describe("getShoppingListSuggestions", () => {
  it("sugere itens abaixo do mínimo que ainda não estão na lista", async () => {
    const ws = await createWorkspace("Loja C");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, minStock: 1000 } });
    await testDb.stockMovement.create({ data: { itemId: item.id, type: "PURCHASE", quantity: 200, workspaceId: ws.id } });

    const suggestions = await getShoppingListSuggestions();
    expect(suggestions.map((s) => s.itemId)).toContain(item.id);
  });

  it("não sugere um item que já está na lista (pendente)", async () => {
    const ws = await createWorkspace("Loja D");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, minStock: 1000 } });
    await testDb.stockMovement.create({ data: { itemId: item.id, type: "PURCHASE", quantity: 200, workspaceId: ws.id } });
    await createShoppingListItem(fd({ itemId: item.id, label: "Farinha" }));

    const suggestions = await getShoppingListSuggestions();
    expect(suggestions.map((s) => s.itemId)).not.toContain(item.id);
  });
});

describe("addSuggestedItem", () => {
  it("cria a linha da lista a partir de uma sugestão, com o déficit como quantidade", async () => {
    const ws = await createWorkspace("Loja E");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, minStock: 1000 } });
    await testDb.stockMovement.create({ data: { itemId: item.id, type: "PURCHASE", quantity: 200, workspaceId: ws.id } });

    const res = await addSuggestedItem(item.id);
    expect(res.ok).toBe(true);

    const items = await getShoppingListItems();
    expect(items[0]).toMatchObject({ itemId: item.id, quantity: 800 });
  });
});

describe("deleteShoppingListItem / toggleShoppingListItem", () => {
  it("apaga um item da lista", async () => {
    const ws = await createWorkspace("Loja F");
    context.workspaceId = ws.id;
    await createShoppingListItem(fd({ label: "Guardanapo" }));
    const [item] = await getShoppingListItems();

    await deleteShoppingListItem(item.id);
    expect(await getShoppingListItems()).toHaveLength(0);
  });

  it("marcar como comprado tira o item da listagem de pendentes", async () => {
    const ws = await createWorkspace("Loja G");
    context.workspaceId = ws.id;
    await createShoppingListItem(fd({ label: "Guardanapo" }));
    const [item] = await getShoppingListItems();

    await toggleShoppingListItem(item.id, true);
    expect(await getShoppingListItems()).toHaveLength(0);
  });
});
