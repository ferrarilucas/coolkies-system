import { getWorkspaceDb } from "@/server/tenant/context";

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
              purchases: {
                orderBy: { purchasedAt: "desc" },
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
      const lastPurchase = ri.ingredient.purchases[0] ?? null;
      if (!lastPurchase || lastPurchase.quantity <= 0) {
        hasAllCosts = false;
        continue;
      }
      const unitCost = lastPurchase.pricePaidCents / lastPurchase.quantity;
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
              purchases: {
                orderBy: { purchasedAt: "desc" },
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
      const last = ri.ingredient.purchases[0] ?? null;
      const unitCostCents =
        last && last.quantity > 0 ? last.pricePaidCents / last.quantity : null;
      return {
        ingredientId: ri.ingredientId,
        ingredientName: ri.ingredient.name,
        baseUnit: ri.ingredient.baseUnit,
        quantity: ri.quantity,
        unitCostCents,
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
      purchases: {
        orderBy: { purchasedAt: "desc" },
        take: 1,
        select: { quantity: true, pricePaidCents: true },
      },
    },
  });

  return ings.map((ing) => {
    const last = ing.purchases[0] ?? null;
    const unitCostCents =
      last && last.quantity > 0 ? last.pricePaidCents / last.quantity : null;
    return {
      id: ing.id,
      name: ing.name,
      baseUnit: ing.baseUnit as string,
      unitCostCents,
    };
  });
}
