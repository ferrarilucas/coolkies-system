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

const { createIngredient, updateIngredient, createIngredientForPurchase } = await import("./ingredients");

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("createIngredient — revenda", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria insumo só de matéria-prima sem produto vinculado", async () => {
    const res = await createIngredient(
      fd({ name: "Açúcar", baseUnit: "G", isRawMaterial: "on" }),
    );
    expect(res.ok).toBe(true);

    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Açúcar" } });
    expect(ing.isRawMaterial).toBe(true);
    expect(ing.forResale).toBe(false);
    expect(ing.resaleProductId).toBeNull();
  });

  it("cria insumo de revenda com produto vinculado automaticamente", async () => {
    const res = await createIngredient(
      fd({ name: "Refrigerante", baseUnit: "UN", forResale: "on" }),
    );
    expect(res.ok).toBe(true);

    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Refrigerante" } });
    expect(ing.forResale).toBe(true);
    expect(ing.resaleProductId).not.toBeNull();

    const product = await testDb.product.findUniqueOrThrow({ where: { id: ing.resaleProductId! } });
    expect(product.name).toBe("Refrigerante");
    expect(product.active).toBe(true);
  });

  it("recusa insumo sem nenhuma finalidade marcada", async () => {
    const res = await createIngredient(fd({ name: "Sem finalidade", baseUnit: "G" }));
    expect(res.ok).toBe(false);
  });
});

describe("updateIngredient — transição de revenda", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 2");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("ao marcar revenda numa edição, cria o produto vinculado", async () => {
    await createIngredient(fd({ name: "Suco", baseUnit: "UN", isRawMaterial: "on" }));
    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Suco" } });
    expect(ing.resaleProductId).toBeNull();

    await updateIngredient(ing.id, fd({ name: "Suco", baseUnit: "UN", isRawMaterial: "on", forResale: "on" }));

    const updated = await testDb.ingredient.findUniqueOrThrow({ where: { id: ing.id } });
    expect(updated.forResale).toBe(true);
    expect(updated.resaleProductId).not.toBeNull();
  });

  it("ao desmarcar revenda, desativa o produto em vez de apagar", async () => {
    await createIngredient(fd({ name: "Água", baseUnit: "UN", forResale: "on" }));
    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Água" } });
    const productId = ing.resaleProductId!;

    await updateIngredient(ing.id, fd({ name: "Água", baseUnit: "UN", isRawMaterial: "on" }));

    const updated = await testDb.ingredient.findUniqueOrThrow({ where: { id: ing.id } });
    expect(updated.forResale).toBe(false);
    expect(updated.resaleProductId).toBe(productId);

    const product = await testDb.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.active).toBe(false);
  });

  it("ao marcar revenda de novo, reativa o produto existente em vez de duplicar", async () => {
    await createIngredient(fd({ name: "Salgadinho", baseUnit: "UN", forResale: "on" }));
    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Salgadinho" } });
    const productId = ing.resaleProductId!;
    await updateIngredient(ing.id, fd({ name: "Salgadinho", baseUnit: "UN", isRawMaterial: "on" }));

    await updateIngredient(ing.id, fd({ name: "Salgadinho", baseUnit: "UN", forResale: "on" }));

    const updated = await testDb.ingredient.findUniqueOrThrow({ where: { id: ing.id } });
    expect(updated.resaleProductId).toBe(productId);
    const product = await testDb.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.active).toBe(true);

    const count = await testDb.product.count({ where: { name: "Salgadinho" } });
    expect(count).toBe(1);
  });
});

describe("createIngredientForPurchase", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 3");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria insumo de revenda direto do fluxo de compra", async () => {
    const res = await createIngredientForPurchase(
      fd({ name: "Chocolate quente", baseUnit: "UN", forResale: "on" }),
    );
    expect(res.ok).toBe(true);
    expect(res.data?.forResale).toBe(true);

    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Chocolate quente" } });
    expect(ing.resaleProductId).not.toBeNull();
  });
});
