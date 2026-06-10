import { db } from "@/lib/db";

export type ProductWithFlavorsAndPrices = Awaited<
  ReturnType<typeof getProductsWithFlavorsAndPrices>
>[number];

export async function getProductsWithFlavorsAndPrices() {
  return db.product.findMany({
    orderBy: { name: "asc" },
    include: {
      flavors: {
        orderBy: { name: "asc" },
        include: {
          priceListItems: {
            include: { history: { orderBy: { changedAt: "desc" }, take: 5 } },
          },
        },
      },
      priceListItems: {
        where: { flavorId: null },
        include: { history: { orderBy: { changedAt: "desc" }, take: 5 } },
      },
    },
  });
}

export type PriceListItemWithHistory = Awaited<
  ReturnType<typeof getPriceHistory>
>[number];

export async function getPriceHistory(priceListItemId: string) {
  return db.priceHistory.findMany({
    where: { priceListItemId },
    orderBy: { changedAt: "desc" },
  });
}
