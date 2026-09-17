"use server";

import { getWorkspaceDb } from "@/server/tenant/context";
import { isLowStock } from "@/lib/stock";
import { unitCostFromLastPurchase } from "./purchase-cost";

// ─── Histórico de produções ───────────────────────────────────────────────────

export type ProductionBatchItem = Awaited<ReturnType<typeof getProductionBatches>>[number];

export async function getProductionBatches() {
  const db = await getWorkspaceDb();
  return db.productionBatch.findMany({
    orderBy: { producedAt: "desc" },
    include: {
      item: { select: { id: true, name: true } },
      variant: { select: { id: true, name: true } },
      recipe: { select: { id: true, name: true, yieldQty: true } },
      variantLines: {
        include: { variant: { select: { id: true, name: true } } },
      },
    },
  });
}

// ─── Detalhe de uma produção (para edição) ───────────────────────────────────

export type ProductionBatchDetail = Awaited<ReturnType<typeof getProductionBatchById>>;

export async function getProductionBatchById(id: string) {
  const db = await getWorkspaceDb();
  return db.productionBatch.findUnique({
    where: { id },
    include: {
      variantLines: { select: { variantId: true, quantity: true } },
    },
  });
}

// ─── Estoque unificado de itens (via StockMovement) ───────────────────────────

export type ItemStockEntry = {
  itemId: string;
  itemName: string;
  variantId: string | null;
  variantName: string | null;
  unit: string;
  current: number;
  minStock: number | null;
  belowMin: boolean;
  sellable: boolean;
  productionInput: boolean;
  latestPriceCents: number | null;
  latestSupplier: string | null;
};

export async function getItemStock(): Promise<ItemStockEntry[]> {
  const db = await getWorkspaceDb();
  const items = await db.item.findMany({
    orderBy: { name: "asc" },
    include: {
      variants: { orderBy: { name: "asc" } },
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        include: { purchase: { select: { supplier: { select: { name: true } } } } },
      },
    },
  });

  const balances = await db.stockMovement.groupBy({
    by: ["itemId", "variantId"],
    _sum: { quantity: true },
  });
  const balanceMap = new Map(
    balances.map((b) => [`${b.itemId}|${b.variantId ?? ""}`, b._sum.quantity ?? 0]),
  );

  const entries: ItemStockEntry[] = [];
  for (const item of items) {
    const lastPurchase = item.purchaseItems[0] ?? null;
    const pricePerUnit = unitCostFromLastPurchase(lastPurchase);
    const latestPriceCents = pricePerUnit !== null ? Math.round(pricePerUnit) : null;
    const latestSupplier = lastPurchase?.purchase.supplier?.name ?? null;
    const base = {
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      minStock: item.minStock ?? null,
      sellable: item.sellable,
      productionInput: item.productionInput,
      latestPriceCents,
      latestSupplier,
    };

    if (item.variants.length === 0) {
      const current = balanceMap.get(`${item.id}|`) ?? 0;
      entries.push({ ...base, variantId: null, variantName: null, current, belowMin: isLowStock(current, item.minStock) });
    } else {
      for (const variant of item.variants) {
        const current = balanceMap.get(`${item.id}|${variant.id}`) ?? 0;
        entries.push({ ...base, variantId: variant.id, variantName: variant.name, current, belowMin: isLowStock(current, item.minStock) });
      }
    }
  }
  return entries;
}
