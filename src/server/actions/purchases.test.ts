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
    const acucar = await testDb.item.create({
      data: { name: "Açúcar", unit: "G", productionInput: true, workspaceId: context.workspaceId },
    });
    const farinha = await testDb.item.create({
      data: { name: "Farinha", unit: "G", productionInput: true, workspaceId: context.workspaceId },
    });

    const res = await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([
          { itemId: acucar.id, quantity: 1, unit: "KG", pricePaidCents: 500 },
          { itemId: farinha.id, quantity: 2, unit: "KG", pricePaidCents: 900 },
        ]),
      }),
    );

    expect(res.ok).toBe(true);
    const purchases = await testDb.purchase.findMany({ include: { items: true } });
    expect(purchases).toHaveLength(1);
    expect(purchases[0].supplierId).toBeNull();
    expect(purchases[0].items).toHaveLength(2);
    const acucarItem = purchases[0].items.find((i) => i.itemId === acucar.id)!;
    expect(acucarItem.quantity).toBe(1000);
    expect(acucarItem.unit).toBe("G");
  });

  it("grava StockMovement(PURCHASE) para qualquer item comprado, revenda ou não", async () => {
    const item = await testDb.item.create({
      data: { name: "Farinha", workspaceId: context.workspaceId, unit: "G", productionInput: true, sellable: false },
    });

    const res = await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([{ itemId: item.id, quantity: 5, unit: "KG", pricePaidCents: 2000 }]),
      }),
    );
    expect(res.ok).toBe(true);

    const movement = await testDb.stockMovement.findFirstOrThrow({
      where: { itemId: item.id, type: "PURCHASE" },
    });
    expect(movement.quantity).toBe(5000);
  });

  it("recusa compra sem itens", async () => {
    const res = await createPurchase(fd({ supplierId: "", purchasedAt: "2026-09-15", items: "[]" }));
    expect(res.ok).toBe(false);
  });

  it("grava a variante no PurchaseItem e no StockMovement de um item de revenda com variantes", async () => {
    const item = await testDb.item.create({
      data: { name: "Refrigerante", unit: "UN", sellable: true, workspaceId: context.workspaceId },
    });
    const lata = await testDb.variant.create({
      data: { name: "Lata", itemId: item.id, workspaceId: context.workspaceId },
    });

    const res = await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([
          { itemId: item.id, variantId: lata.id, quantity: 12, unit: "UN", pricePaidCents: 2400 },
        ]),
      }),
    );

    expect(res.ok).toBe(true);
    const purchaseItem = await testDb.purchaseItem.findFirstOrThrow({ where: { itemId: item.id } });
    expect(purchaseItem.variantId).toBe(lata.id);
    const movement = await testDb.stockMovement.findFirstOrThrow({
      where: { itemId: item.id, type: "PURCHASE" },
    });
    expect(movement.variantId).toBe(lata.id);
  });

  it("recusa comprar um item com variantes sem escolher a variante", async () => {
    const item = await testDb.item.create({
      data: { name: "Refrigerante", unit: "UN", sellable: true, workspaceId: context.workspaceId },
    });
    await testDb.variant.create({
      data: { name: "Lata", itemId: item.id, workspaceId: context.workspaceId },
    });

    const res = await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([{ itemId: item.id, quantity: 12, unit: "UN", pricePaidCents: 2400 }]),
      }),
    );

    expect(res.ok).toBe(false);
  });

  it("recusa uma variante que não pertence ao item selecionado", async () => {
    const item = await testDb.item.create({
      data: { name: "Refrigerante", unit: "UN", sellable: true, workspaceId: context.workspaceId },
    });
    const outroItem = await testDb.item.create({
      data: { name: "Suco", unit: "UN", sellable: true, workspaceId: context.workspaceId },
    });
    const variantDeOutroItem = await testDb.variant.create({
      data: { name: "Garrafa", itemId: outroItem.id, workspaceId: context.workspaceId },
    });

    const res = await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([
          { itemId: item.id, variantId: variantDeOutroItem.id, quantity: 12, unit: "UN", pricePaidCents: 2400 },
        ]),
      }),
    );

    expect(res.ok).toBe(false);
  });
});

describe("deletePurchase", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 3");
    context.workspaceId = workspace.id;
    context.canWrite = true;
    await testDb.user.create({
      data: { id: context.userId, name: "Usuário Teste", email: "u1@example.com" },
    });
  });

  it("exclui a compra e todos os seus itens", async () => {
    const item = await testDb.item.create({
      data: { name: "Ovos", unit: "UN", workspaceId: context.workspaceId },
    });
    const purchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchase.id, itemId: item.id, quantity: 12, unit: "UN", pricePaidCents: 1200, workspaceId: context.workspaceId },
    });

    const res = await deletePurchase(purchase.id);
    expect(res.ok).toBe(true);
    expect(await testDb.purchase.count()).toBe(0);
    expect(await testDb.purchaseItem.count()).toBe(0);
  });

  it("exclui também os StockMovement(PURCHASE) que a compra gerou", async () => {
    const item = await testDb.item.create({
      data: { name: "Suco de laranja", unit: "UN", sellable: true, workspaceId: context.workspaceId },
    });

    const createRes = await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([{ itemId: item.id, quantity: 10, unit: "UN", pricePaidCents: 3000 }]),
      }),
    );
    expect(createRes.ok).toBe(true);

    const purchase = await testDb.purchase.findFirstOrThrow();
    expect(await testDb.stockMovement.count({ where: { purchaseId: purchase.id } })).toBe(1);

    const res = await deletePurchase(purchase.id);
    expect(res.ok).toBe(true);
    expect(await testDb.stockMovement.count({ where: { purchaseId: purchase.id } })).toBe(0);
    expect(await testDb.stockMovement.count({ where: { itemId: item.id } })).toBe(0);
  });
});

describe("fetchLastPriceForSupplierItem", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 4");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("retorna o preço lembrado daquele fornecedor+item", async () => {
    const item = await testDb.item.create({
      data: { name: "Açúcar", unit: "G", workspaceId: context.workspaceId },
    });
    const supplier = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: context.workspaceId },
    });
    const purchase = await testDb.purchase.create({
      data: { supplierId: supplier.id, workspaceId: context.workspaceId },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchase.id, itemId: item.id, quantity: 1000, unit: "G", pricePaidCents: 450, workspaceId: context.workspaceId },
    });

    const result = await fetchLastPriceForSupplierItem(supplier.id, item.id);
    expect(result).toMatchObject({ quantity: 1000, unit: "G", pricePaidCents: 450 });
  });

  it("retorna null quando o par fornecedor+item nunca teve compra", async () => {
    const item = await testDb.item.create({
      data: { name: "Farinha", unit: "G", workspaceId: context.workspaceId },
    });
    const supplier = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: context.workspaceId },
    });

    const result = await fetchLastPriceForSupplierItem(supplier.id, item.id);
    expect(result).toBeNull();
  });

  it("lembra o preço por variante, não misturando com o de outra variante do mesmo item", async () => {
    const item = await testDb.item.create({
      data: { name: "Refrigerante", unit: "UN", sellable: true, workspaceId: context.workspaceId },
    });
    const lata = await testDb.variant.create({
      data: { name: "Lata", itemId: item.id, workspaceId: context.workspaceId },
    });
    const garrafa = await testDb.variant.create({
      data: { name: "Garrafa", itemId: item.id, workspaceId: context.workspaceId },
    });
    const purchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchase.id, itemId: item.id, variantId: lata.id, quantity: 12, unit: "UN", pricePaidCents: 2400, workspaceId: context.workspaceId },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchase.id, itemId: item.id, variantId: garrafa.id, quantity: 6, unit: "UN", pricePaidCents: 1800, workspaceId: context.workspaceId },
    });

    const resultLata = await fetchLastPriceForSupplierItem(null, item.id, lata.id);
    expect(resultLata).toMatchObject({ quantity: 12, pricePaidCents: 2400 });

    const resultGarrafa = await fetchLastPriceForSupplierItem(null, item.id, garrafa.id);
    expect(resultGarrafa).toMatchObject({ quantity: 6, pricePaidCents: 1800 });
  });
});
