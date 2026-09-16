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

const { saveItem } = await import("./catalog");

describe("saveItem", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria um item novo com uma variante e preço, e o item fica sellable", async () => {
    const res = await saveItem(null, {
      name: "Cookie",
      genericPriceCents: null,
      variants: [
        { id: null, name: "Chocolate", priceCents: 500, recipeId: null, active: true },
      ],
      removedVariantIds: [],
    });

    expect(res.ok).toBe(true);
    const itemId = res.data?.id;
    expect(itemId).toBeDefined();

    const item = await testDb.item.findUniqueOrThrow({ where: { id: itemId! } });
    expect(item.name).toBe("Cookie");
    expect(item.sellable).toBe(true);

    const variant = await testDb.variant.findFirstOrThrow({ where: { itemId: itemId! } });
    expect(variant.name).toBe("Chocolate");

    const priceListItem = await testDb.priceListItem.findFirstOrThrow({
      where: { itemId: itemId!, variantId: variant.id },
    });
    expect(priceListItem.priceCents).toBe(500);
  });

  it("desativa (não apaga) uma variante removida que ainda está referenciada em produção", async () => {
    const createRes = await saveItem(null, {
      name: "Bolo",
      genericPriceCents: null,
      variants: [
        { id: null, name: "Cenoura", priceCents: 800, recipeId: null, active: true },
      ],
      removedVariantIds: [],
    });
    expect(createRes.ok).toBe(true);
    const itemId = createRes.data!.id;

    const variant = await testDb.variant.findFirstOrThrow({ where: { itemId } });

    await testDb.productionBatch.create({
      data: {
        itemId,
        variantId: variant.id,
        quantity: 10,
        workspaceId: context.workspaceId,
      },
    });

    const res = await saveItem(itemId, {
      name: "Bolo",
      genericPriceCents: 800,
      variants: [],
      removedVariantIds: [variant.id],
    });

    expect(res.ok).toBe(true);
    expect(res.data?.deactivated).toContain("Cenoura");

    const stillThere = await testDb.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(stillThere.active).toBe(false);
  });

  it("apaga de fato uma variante removida que não tem nenhuma referência", async () => {
    const createRes = await saveItem(null, {
      name: "Torta",
      genericPriceCents: null,
      variants: [
        { id: null, name: "Limão", priceCents: 700, recipeId: null, active: true },
      ],
      removedVariantIds: [],
    });
    expect(createRes.ok).toBe(true);
    const itemId = createRes.data!.id;
    const variant = await testDb.variant.findFirstOrThrow({ where: { itemId } });

    const res = await saveItem(itemId, {
      name: "Torta",
      genericPriceCents: 700,
      variants: [],
      removedVariantIds: [variant.id],
    });

    expect(res.ok).toBe(true);
    expect(res.data?.deactivated).toEqual([]);

    const gone = await testDb.variant.findUnique({ where: { id: variant.id } });
    expect(gone).toBeNull();
  });
});
