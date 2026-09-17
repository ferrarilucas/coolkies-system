import { getWorkspaceDb } from "@/server/tenant/context";

export type ItemWithVariantsAndPrices = Awaited<
  ReturnType<typeof getItemsWithVariantsAndPrices>
>[number];

export async function getItemsWithVariantsAndPrices() {
  const db = await getWorkspaceDb();
  return db.item.findMany({
    where: { sellable: true },
    orderBy: { name: "asc" },
    include: {
      variants: {
        orderBy: { name: "asc" },
        include: {
          priceListItems: {
            include: { history: { orderBy: { changedAt: "desc" }, take: 5 } },
          },
        },
      },
      priceListItems: {
        where: { variantId: null },
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

export type ItemForEdit = NonNullable<
  Awaited<ReturnType<typeof getItemForEdit>>
>;

export async function getItemForEdit(id: string) {
  const db = await getWorkspaceDb();
  const item = await db.item.findUnique({
    where: { id },
    include: {
      variants: {
        orderBy: { name: "asc" },
        include: {
          priceListItems: { select: { priceCents: true } },
          _count: { select: { saleItems: true, productionBatches: true } },
        },
      },
      priceListItems: {
        where: { variantId: null },
        select: { priceCents: true },
      },
    },
  });
  if (!item) return null;

  return {
    id: item.id,
    name: item.name,
    active: item.active,
    genericPriceCents: item.priceListItems[0]?.priceCents ?? null,
    variants: item.variants.map((v) => ({
      id: v.id,
      name: v.name,
      active: v.active,
      recipeId: v.recipeId,
      priceCents: v.priceListItems[0]?.priceCents ?? null,
      inUse: v._count.saleItems > 0 || v._count.productionBatches > 0,
    })),
  };
}

/** Resumo por item para a lista do catálogo. */
export async function getCatalogOverview() {
  const items = await getItemsWithVariantsAndPrices();
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    active: i.active,
    genericPriceCents:
      i.priceListItems.find((p) => p.variantId === null)?.priceCents ?? null,
    variants: i.variants.map((v) => ({
      id: v.id,
      name: v.name,
      active: v.active,
      priceCents: v.priceListItems[0]?.priceCents ?? null,
    })),
  }));
}
