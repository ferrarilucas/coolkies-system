import { getWorkspaceDb } from "@/server/tenant/context";
import { unitCostFromLastPurchase } from "./purchase-cost";

// ─── Lista com custo estimado ────────────────────────────────────────────────

export type RecipeListItem = Awaited<ReturnType<typeof getRecipesWithCost>>[number];

export async function getRecipesWithCost() {
  const db = await getWorkspaceDb();
  const recipes = await db.recipe.findMany({
    orderBy: { name: "asc" },
    include: {
      ingredients: {
        include: {
          ingredient: {
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
    let hasAllCosts = recipe.ingredients.length > 0;

    for (const ri of recipe.ingredients) {
      const lastPurchase = ri.ingredient.purchaseItems[0] ?? null;
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
      ingredientCount: recipe.ingredients.length,
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
      ingredients: {
        include: {
          ingredient: {
            include: {
              purchaseItems: {
                orderBy: { purchase: { purchasedAt: "desc" } },
                take: 1,
                select: { quantity: true, pricePaidCents: true },
              },
            },
          },
        },
        orderBy: { ingredient: { name: "asc" } },
      },
    },
  });

  if (!recipe) return null;

  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ri) => {
      const last = ri.ingredient.purchaseItems[0] ?? null;
      return {
        ingredientId: ri.ingredientId,
        ingredientName: ri.ingredient.name,
        baseUnit: ri.ingredient.baseUnit,
        quantity: ri.quantity,
        unitCostCents: unitCostFromLastPurchase(last),
      };
    }),
  };
}

// ─── Lista de ingredientes disponíveis (para o select no form) ───────────────

export type IngredientOption = Awaited<ReturnType<typeof getIngredientOptions>>[number];

export async function getIngredientOptions() {
  const db = await getWorkspaceDb();
  const ings = await db.ingredient.findMany({
    orderBy: { name: "asc" },
    include: {
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        select: { quantity: true, pricePaidCents: true },
      },
    },
  });

  return ings.map((ing) => ({
    id: ing.id,
    name: ing.name,
    baseUnit: ing.baseUnit as string,
    unitCostCents: unitCostFromLastPurchase(ing.purchaseItems[0] ?? null),
  }));
}
