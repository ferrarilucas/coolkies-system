"use server";

import { db } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { formatQty } from "@/lib/units";
import { isLowStock } from "@/lib/stock";

// ─── Histórico de produções ───────────────────────────────────────────────────

export type ProductionBatchItem = Awaited<ReturnType<typeof getProductionBatches>>[number];

export async function getProductionBatches() {
  return db.productionBatch.findMany({
    orderBy: { producedAt: "desc" },
    include: {
      product: { select: { id: true, name: true } },
      flavor: { select: { id: true, name: true } },
      recipe: { select: { id: true, name: true, yieldQty: true } },
      fillings: {
        include: { flavor: { select: { id: true, name: true } } },
      },
    },
  });
}

// ─── Detalhe de uma produção (para edição) ───────────────────────────────────

export type ProductionBatchDetail = Awaited<ReturnType<typeof getProductionBatchById>>;

export async function getProductionBatchById(id: string) {
  return db.productionBatch.findUnique({
    where: { id },
    include: {
      fillings: {
        select: { flavorId: true, quantity: true },
      },
    },
  });
}

// ─── Estoque atual de cookies ─────────────────────────────────────────────────

export type CookieStockEntry = {
  productId: string;
  productName: string;
  flavorId: string | null;
  flavorName: string | null;
  produced: number;
  sold: number;
  current: number;
};

export async function getCookieStock(): Promise<CookieStockEntry[]> {
  // Fonte de verdade para produção: ProductionFilling (direto, sem StockMovement)
  const fillings = await db.productionFilling.findMany({
    select: {
      flavorId: true,
      quantity: true,
      productionBatch: { select: { productId: true } },
    },
  });

  // Fonte de verdade para vendas: SaleItem (inclui pago + pendente)
  const saleItems = await db.saleItem.findMany({
    where: { flavorId: { not: null } },
    select: { productId: true, flavorId: true, quantity: true },
  });

  const products = await db.product.findMany({ select: { id: true, name: true } });
  const flavors = await db.flavor.findMany({ select: { id: true, name: true } });

  const productMap = new Map(products.map((p) => [p.id, p.name]));
  const flavorMap = new Map(flavors.map((f) => [f.id, f.name]));

  // Agrega produzidos por (productId, flavorId)
  const producedMap = new Map<string, number>();
  for (const f of fillings) {
    const key = `${f.productionBatch.productId}|${f.flavorId}`;
    producedMap.set(key, (producedMap.get(key) ?? 0) + f.quantity);
  }

  // Agrega vendidos por (productId, flavorId)
  const soldMap = new Map<string, number>();
  for (const item of saleItems) {
    if (!item.flavorId) continue;
    const key = `${item.productId}|${item.flavorId}`;
    soldMap.set(key, (soldMap.get(key) ?? 0) + item.quantity);
  }

  const keys = new Set([...producedMap.keys(), ...soldMap.keys()]);

  return Array.from(keys)
    .map((key) => {
      const [productId, flavorId] = key.split("|");
      if (!flavorId || flavorId === "null") return null;
      const p = producedMap.get(key) ?? 0;
      const s = soldMap.get(key) ?? 0;
      return {
        productId,
        productName: productMap.get(productId) ?? productId,
        flavorId,
        flavorName: flavorMap.get(flavorId) ?? flavorId,
        produced: p,
        sold: s,
        current: p - s,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.productName.localeCompare(b.productName));
}

// ─── Estoque de ingredientes (despensa) ───────────────────────────────────────

export type PantryEntry = {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  purchased: number;
  consumed: number;
  current: number;
  minStock: number | null;
  belowMin: boolean;
  latestPriceCents: number | null;    // preço por unidade base (centavos)
  latestMarket: string | null;
};

export async function getPantryStock(): Promise<PantryEntry[]> {
  const ingredients = await db.ingredient.findMany({
    orderBy: { name: "asc" },
    include: {
      purchases: {
        orderBy: { purchasedAt: "desc" },
        take: 1,
        include: { market: { select: { name: true } } },
      },
    },
  });

  // Total comprado por ingrediente
  const purchaseSums = await db.ingredientPurchase.groupBy({
    by: ["ingredientId"],
    _sum: { quantity: true },
  });
  const purchaseMap = new Map(
    purchaseSums.map((r) => [r.ingredientId, r._sum.quantity ?? 0]),
  );

  // Total consumido em produções (via IngredientConsumption — calculado abaixo)
  // Para calcular o consumo real precisamos percorrer as produções com receita
  const consumptionMap = await buildConsumptionMap();

  return ingredients.map((ing) => {
    const purchased = purchaseMap.get(ing.id) ?? 0;
    const consumed = consumptionMap.get(ing.id) ?? 0;
    const current = purchased - consumed;
    const lastPurchase = ing.purchases[0];
    const pricePerUnit =
      lastPurchase && lastPurchase.quantity > 0
        ? lastPurchase.pricePaidCents / lastPurchase.quantity
        : null;

    return {
      ingredientId: ing.id,
      ingredientName: ing.name,
      baseUnit: ing.baseUnit,
      purchased,
      consumed,
      current,
      minStock: ing.minStock ?? null,
      belowMin: isLowStock(current, ing.minStock),
      latestPriceCents: pricePerUnit !== null ? Math.round(pricePerUnit) : null,
      latestMarket: lastPurchase?.market.name ?? null,
    };
  });
}

/** Constrói mapa ingredientId → quantidade consumida em produções */
async function buildConsumptionMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  const batches = await db.productionBatch.findMany({
    where: { recipeId: { not: null } },
    include: {
      recipe: {
        include: { ingredients: true },
      },
      fillings: {
        include: {
          flavor: {
            include: {
              fillingRecipe: { include: { ingredients: true } },
            },
          },
        },
      },
    },
  });

  for (const batch of batches) {
    if (!batch.recipe) continue;
    const yieldQty = batch.recipe.yieldQty || 1;
    // Quantos "lotes de receita" foram feitos
    const batches_count = batch.quantity / yieldQty;

    // Consumo base
    for (const ri of batch.recipe.ingredients) {
      const prev = map.get(ri.ingredientId) ?? 0;
      map.set(ri.ingredientId, prev + ri.quantity * batches_count);
    }

    // Consumo de recheios
    for (const filling of batch.fillings) {
      const fillingRecipe = filling.flavor.fillingRecipe;
      if (!fillingRecipe) continue;
      for (const ri of fillingRecipe.ingredients) {
        const prev = map.get(ri.ingredientId) ?? 0;
        // filling.quantity cookies recheados × ingrediente por cookie
        map.set(ri.ingredientId, prev + ri.quantity * filling.quantity);
      }
    }
  }

  return map;
}
