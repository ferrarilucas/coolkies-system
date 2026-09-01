import { getWorkspaceDb } from "@/server/tenant/context";

export type ProductWithFlavorsAndPrices = Awaited<
  ReturnType<typeof getProductsWithFlavorsAndPrices>
>[number];

export async function getProductsWithFlavorsAndPrices() {
  const db = await getWorkspaceDb();
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
  const db = await getWorkspaceDb();
  return db.priceHistory.findMany({
    where: { priceListItemId },
    orderBy: { changedAt: "desc" },
  });
}

export type ProductForEdit = NonNullable<
  Awaited<ReturnType<typeof getProductForEdit>>
>;

export async function getProductForEdit(id: string) {
  const db = await getWorkspaceDb();
  const product = await db.product.findUnique({
    where: { id },
    include: {
      flavors: {
        orderBy: { name: "asc" },
        include: {
          priceListItems: { select: { priceCents: true } },
          _count: { select: { saleItems: true, productionBatches: true } },
        },
      },
      priceListItems: {
        where: { flavorId: null },
        select: { priceCents: true },
      },
    },
  });
  if (!product) return null;

  return {
    id: product.id,
    name: product.name,
    active: product.active,
    genericPriceCents: product.priceListItems[0]?.priceCents ?? null,
    flavors: product.flavors.map((f) => ({
      id: f.id,
      name: f.name,
      active: f.active,
      fillingRecipeId: f.fillingRecipeId,
      priceCents: f.priceListItems[0]?.priceCents ?? null,
      inUse: f._count.saleItems > 0 || f._count.productionBatches > 0,
    })),
  };
}

/** Resumo por produto para a lista do catálogo. */
export async function getCatalogOverview() {
  const products = await getProductsWithFlavorsAndPrices();
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    active: p.active,
    genericPriceCents:
      p.priceListItems.find((i) => i.flavorId === null)?.priceCents ?? null,
    flavors: p.flavors.map((f) => ({
      id: f.id,
      name: f.name,
      active: f.active,
      priceCents: f.priceListItems[0]?.priceCents ?? null,
    })),
  }));
}
