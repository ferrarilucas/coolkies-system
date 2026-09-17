import { getWorkspaceDb } from "@/server/tenant/context";
import { unitCostFromLastPurchase } from "./purchase-cost";

// ─── Lista com custo estimado ────────────────────────────────────────────────

export type RecipeListItem = Awaited<ReturnType<typeof getRecipesWithCost>>[number];

export async function getRecipesWithCost() {
  const db = await getWorkspaceDb();
  const recipes = await db.recipe.findMany({
    orderBy: { name: "asc" },
    include: {
      items: {
        include: {
          item: {
            include: {
              purchaseItems: {
                orderBy: { purchase: { purchasedAt: "desc" } },
                take: 1,
                select: { quantity: true, pricePaidCents: true },
              },
            },
          },
        },
      },
    },
  });

  return recipes.map((recipe) => {
    let totalCostCents = 0;
    let hasAllCosts = recipe.items.length > 0;

    for (const ri of recipe.items) {
      const lastPurchase = ri.item.purchaseItems[0] ?? null;
      const unitCost = unitCostFromLastPurchase(lastPurchase);
      if (unitCost === null) {
        hasAllCosts = false;
        continue;
      }
      totalCostCents += unitCost * ri.quantity;
    }

    return {
      id: recipe.id,
      name: recipe.name,
      yieldQty: recipe.yieldQty,
      notes: recipe.notes,
      ingredientCount: recipe.items.length,
      totalCostCents: hasAllCosts ? totalCostCents : null,
      costPerUnitCents: hasAllCosts && recipe.yieldQty > 0
        ? totalCostCents / recipe.yieldQty
        : null,
    };
  });
}

// ─── Receita completa para edição ────────────────────────────────────────────

export type RecipeDetail = Awaited<ReturnType<typeof getRecipeById>>;

export async function getRecipeById(id: string) {
  const db = await getWorkspaceDb();
  const recipe = await db.recipe.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          item: {
            include: {
              purchaseItems: {
                orderBy: { purchase: { purchasedAt: "desc" } },
                take: 1,
                select: { quantity: true, pricePaidCents: true },
              },
            },
          },
        },
        orderBy: { item: { name: "asc" } },
      },
    },
  });

  if (!recipe) return null;

  return {
    ...recipe,
    ingredients: recipe.items.map((ri) => {
      const last = ri.item.purchaseItems[0] ?? null;
      return {
        itemId: ri.itemId,
        itemName: ri.item.name,
        unit: ri.item.unit,
        quantity: ri.quantity,
        unitCostCents: unitCostFromLastPurchase(last),
      };
    }),
  };
}

// ─── Lista de itens disponíveis (para o select no form) ──────────────────────

export type ItemOption = Awaited<ReturnType<typeof getItemOptions>>[number];

export async function getItemOptions() {
  const db = await getWorkspaceDb();
  const items = await db.item.findMany({
    where: { productionInput: true },
    orderBy: { name: "asc" },
    include: {
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        select: { quantity: true, pricePaidCents: true },
      },
    },
  });

  return items.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit as string,
    unitCostCents: unitCostFromLastPurchase(item.purchaseItems[0] ?? null),
  }));
}
