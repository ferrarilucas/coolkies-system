import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { saveRecipe, createItemInline } = await import("./recipes");

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("saveRecipe", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria Receitas");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria uma receita nova com linhas RecipeItem corretas", async () => {
    const farinha = await testDb.item.create({
      data: { name: "Farinha", unit: "G", productionInput: true, workspaceId: context.workspaceId },
    });
    const acucar = await testDb.item.create({
      data: { name: "Açúcar", unit: "G", productionInput: true, workspaceId: context.workspaceId },
    });

    const res = await saveRecipe(
      fd({
        name: "Cookie Base",
        yieldQty: "20",
        items: JSON.stringify([
          { itemId: farinha.id, quantity: 500 },
          { itemId: acucar.id, quantity: 200 },
        ]),
      }),
    );

    expect(res.ok).toBe(true);
    const recipeId = res.data!.id;

    const lines = await testDb.recipeItem.findMany({ where: { recipeId }, orderBy: { itemId: "asc" } });
    expect(lines).toHaveLength(2);

    const farinhaLine = lines.find((l) => l.itemId === farinha.id)!;
    expect(farinhaLine).toBeDefined();
    expect(farinhaLine.quantity).toBe(500);

    const acucarLine = lines.find((l) => l.itemId === acucar.id)!;
    expect(acucarLine).toBeDefined();
    expect(acucarLine.quantity).toBe(200);
  });

  it("atualiza uma receita existente substituindo as linhas RecipeItem, sem acumular duplicatas", async () => {
    const farinha = await testDb.item.create({
      data: { name: "Farinha", unit: "G", productionInput: true, workspaceId: context.workspaceId },
    });
    const acucar = await testDb.item.create({
      data: { name: "Açúcar", unit: "G", productionInput: true, workspaceId: context.workspaceId },
    });
    const manteiga = await testDb.item.create({
      data: { name: "Manteiga", unit: "G", productionInput: true, workspaceId: context.workspaceId },
    });

    const created = await saveRecipe(
      fd({
        name: "Cookie Base",
        yieldQty: "20",
        items: JSON.stringify([
          { itemId: farinha.id, quantity: 500 },
          { itemId: acucar.id, quantity: 200 },
        ]),
      }),
    );
    expect(created.ok).toBe(true);
    const recipeId = created.data!.id;

    const updated = await saveRecipe(
      fd({
        id: recipeId,
        name: "Cookie Base",
        yieldQty: "20",
        items: JSON.stringify([
          { itemId: farinha.id, quantity: 600 },
          { itemId: manteiga.id, quantity: 100 },
        ]),
      }),
    );
    expect(updated.ok).toBe(true);

    const lines = await testDb.recipeItem.findMany({ where: { recipeId } });
    expect(lines).toHaveLength(2);

    const farinhaLine = lines.find((l) => l.itemId === farinha.id)!;
    expect(farinhaLine).toBeDefined();
    expect(farinhaLine.quantity).toBe(600);

    expect(lines.find((l) => l.itemId === acucar.id)).toBeUndefined();

    const manteigaLine = lines.find((l) => l.itemId === manteiga.id)!;
    expect(manteigaLine).toBeDefined();
    expect(manteigaLine.quantity).toBe(100);
  });
});

describe("createItemInline", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria Receitas 2");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria um item com productionInput true", async () => {
    const res = await createItemInline(fd({ name: "Fermento", unit: "G" }));
    expect(res.ok).toBe(true);

    const item = await testDb.item.findUnique({ where: { id: res.data!.id } });
    expect(item).not.toBeNull();
    expect(item!.productionInput).toBe(true);
  });
});
