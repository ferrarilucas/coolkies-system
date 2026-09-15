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

const { createSupplierInline, createPurchase, deletePurchase, fetchLastPriceForSupplierItem } =
  await import("./purchases");

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("createSupplierInline", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria um fornecedor com apenas o nome", async () => {
    const res = await createSupplierInline(fd({ name: "Atacadão" }));
    expect(res.ok).toBe(true);
    expect(res.data?.name).toBe("Atacadão");
  });

  it("recusa nome duplicado", async () => {
    await createSupplierInline(fd({ name: "Atacadão" }));
    const res = await createSupplierInline(fd({ name: "Atacadão" }));
    expect(res.ok).toBe(false);
  });
});

describe("createPurchase", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 2");
    context.workspaceId = workspace.id;
    context.canWrite = true;
    await testDb.user.create({
      data: { id: context.userId, name: "Usuário Teste", email: "u1@example.com" },
    });
  });

  it("registra vários itens numa única compra, sem fornecedor", async () => {
    const acucar = await testDb.ingredient.create({
      data: { name: "Açúcar", baseUnit: "G", workspaceId: context.workspaceId },
    });
    const farinha = await testDb.ingredient.create({
      data: { name: "Farinha", baseUnit: "G", workspaceId: context.workspaceId },
    });

    const res = await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([
          { ingredientId: acucar.id, quantity: 1, unit: "KG", pricePaidCents: 500 },
          { ingredientId: farinha.id, quantity: 2, unit: "KG", pricePaidCents: 900 },
        ]),
      }),
    );

    expect(res.ok).toBe(true);
    const purchases = await testDb.purchase.findMany({ include: { items: true } });
    expect(purchases).toHaveLength(1);
    expect(purchases[0].supplierId).toBeNull();
    expect(purchases[0].items).toHaveLength(2);
    const acucarItem = purchases[0].items.find((i) => i.ingredientId === acucar.id)!;
    expect(acucarItem.quantity).toBe(1000);
    expect(acucarItem.unit).toBe("G");
  });

  it("emite StockMovement de compra para insumo de revenda", async () => {
    const product = await testDb.product.create({
      data: { name: "Refrigerante", workspaceId: context.workspaceId },
    });
    const refri = await testDb.ingredient.create({
      data: {
        name: "Refrigerante", baseUnit: "UN", isRawMaterial: false, forResale: true,
        resaleProductId: product.id, workspaceId: context.workspaceId,
      },
    });

    await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([{ ingredientId: refri.id, quantity: 24, unit: "UN", pricePaidCents: 4800 }]),
      }),
    );

    const movements = await testDb.stockMovement.findMany({ where: { productId: product.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "PURCHASE", quantity: 24 });
  });

  it("não emite StockMovement para insumo só de matéria-prima", async () => {
    const acucar = await testDb.ingredient.create({
      data: { name: "Açúcar", baseUnit: "G", workspaceId: context.workspaceId },
    });

    await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([{ ingredientId: acucar.id, quantity: 1, unit: "KG", pricePaidCents: 500 }]),
      }),
    );

    const movements = await testDb.stockMovement.count();
    expect(movements).toBe(0);
  });

  it("recusa compra sem itens", async () => {
    const res = await createPurchase(fd({ supplierId: "", purchasedAt: "2026-09-15", items: "[]" }));
    expect(res.ok).toBe(false);
  });
});

describe("deletePurchase", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 3");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("exclui a compra e todos os seus itens", async () => {
    const ing = await testDb.ingredient.create({
      data: { name: "Ovos", baseUnit: "UN", workspaceId: context.workspaceId },
    });
    const purchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchase.id, ingredientId: ing.id, quantity: 12, unit: "UN", pricePaidCents: 1200, workspaceId: context.workspaceId },
    });

    const res = await deletePurchase(purchase.id);
    expect(res.ok).toBe(true);
    expect(await testDb.purchase.count()).toBe(0);
    expect(await testDb.purchaseItem.count()).toBe(0);
  });
});

describe("fetchLastPriceForSupplierItem", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 4");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("retorna o preço lembrado daquele fornecedor+insumo", async () => {
    const ing = await testDb.ingredient.create({
      data: { name: "Açúcar", baseUnit: "G", workspaceId: context.workspaceId },
    });
    const supplier = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: context.workspaceId },
    });
    const purchase = await testDb.purchase.create({
      data: { supplierId: supplier.id, workspaceId: context.workspaceId },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchase.id, ingredientId: ing.id, quantity: 1000, unit: "G", pricePaidCents: 450, workspaceId: context.workspaceId },
    });

    const result = await fetchLastPriceForSupplierItem(supplier.id, ing.id);
    expect(result).toMatchObject({ quantity: 1000, unit: "G", pricePaidCents: 450 });
  });

  it("retorna null quando o par fornecedor+insumo nunca teve compra", async () => {
    const ing = await testDb.ingredient.create({
      data: { name: "Farinha", baseUnit: "G", workspaceId: context.workspaceId },
    });
    const supplier = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: context.workspaceId },
    });

    const result = await fetchLastPriceForSupplierItem(supplier.id, ing.id);
    expect(result).toBeNull();
  });
});
