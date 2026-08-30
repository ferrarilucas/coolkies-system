import { getWorkspaceDb } from "@/server/tenant/context";

export type IngredientWithCost = Awaited<
  ReturnType<typeof getIngredientsWithLastCost>
>[number];

export async function getIngredientsWithLastCost() {
  const db = await getWorkspaceDb();
  const ingredients = await db.ingredient.findMany({
    orderBy: { name: "asc" },
    include: {
      purchases: {
        orderBy: { purchasedAt: "desc" },
        take: 1,
        select: {
          quantity: true,
          unit: true,
          pricePaidCents: true,
          purchasedAt: true,
        },
      },
    },
  });

  return ingredients.map((ing) => {
    const last = ing.purchases[0] ?? null;
    // custo por unidade base = pricePaidCents / quantity (já em unidade base)
    const unitCostCents = last && last.quantity > 0
      ? last.pricePaidCents / last.quantity
      : null;

    return { ...ing, lastPurchase: last, unitCostCents };
  });
}
