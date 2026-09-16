import { getWorkspaceDb } from "@/server/tenant/context";
import { unitCostFromLastPurchase } from "./purchase-cost";

export type ItemWithCost = Awaited<ReturnType<typeof getItemsWithLastCost>>[number];

export async function getItemsWithLastCost() {
  const db = await getWorkspaceDb();
  const items = await db.item.findMany({
    orderBy: { name: "asc" },
    include: {
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        select: { quantity: true, pricePaidCents: true },
      },
    },
  });

  return items.map((item) => {
    const last = item.purchaseItems[0] ?? null;
    const unitCostCents = unitCostFromLastPurchase(last);
    const { purchaseItems, ...rest } = item;
    return { ...rest, lastPurchase: last, unitCostCents };
  });
}
