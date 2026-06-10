"use server";

import { db } from "@/lib/db";

// ─── Mercados ─────────────────────────────────────────────────────────────────

export type MarketItem = Awaited<ReturnType<typeof getMarkets>>[number];

export async function getMarkets() {
  return db.market.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { purchases: true } } },
  });
}

// ─── Compras ──────────────────────────────────────────────────────────────────

export type PurchaseItem = Awaited<ReturnType<typeof getPurchases>>[number];

export async function getPurchases() {
  return db.ingredientPurchase.findMany({
    orderBy: { purchasedAt: "desc" },
    include: {
      market: { select: { id: true, name: true } },
      ingredient: { select: { id: true, name: true, baseUnit: true } },
    },
  });
}

// ─── Último preço por ingrediente ────────────────────────────────────────────

export type LatestPrice = Awaited<ReturnType<typeof getLatestPricesByIngredient>>[number];

export async function getLatestPricesByIngredient() {
  // Para cada ingrediente, pega a compra mais recente
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

  return ingredients
    .filter((i) => i.purchases.length > 0)
    .map((i) => {
      const p = i.purchases[0];
      const pricePerUnit =
        p.quantity > 0 ? Math.round(p.pricePaidCents / p.quantity) : 0;
      return {
        ingredientId: i.id,
        ingredientName: i.name,
        baseUnit: i.baseUnit,
        latestPurchase: {
          marketName: p.market.name,
          quantity: p.quantity,
          unit: p.unit,
          pricePaidCents: p.pricePaidCents,
          pricePerUnitCents: pricePerUnit, // centavos por unidade base
          purchasedAt: p.purchasedAt,
        },
      };
    });
}
