import { getWorkspaceDb } from "@/server/tenant/context";
import { unitCostFromLastPurchase } from "./purchase-cost";

export type IngredientWithCost = Awaited<
  ReturnType<typeof getIngredientsWithLastCost>
>[number];

export async function getIngredientsWithLastCost() {
  const db = await getWorkspaceDb();
  const ingredients = await db.ingredient.findMany({
    orderBy: { name: "asc" },
    include: {
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        select: { quantity: true, pricePaidCents: true },
      },
    },
  });

  return ingredients.map((ing) => {
    const last = ing.purchaseItems[0] ?? null;
    const unitCostCents = unitCostFromLastPurchase(last);
    const { purchaseItems, ...rest } = ing;
    return { ...rest, lastPurchase: last, unitCostCents };
  });
}
