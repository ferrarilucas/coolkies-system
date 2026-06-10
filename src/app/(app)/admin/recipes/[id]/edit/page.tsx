import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { RecipeForm } from "@/components/recipes/recipe-form";
import { getRecipeById, getIngredientOptions } from "@/server/queries/recipes";
import type { PartialBlock } from "@blocknote/core";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [recipe, ingredients] = await Promise.all([
    getRecipeById(id),
    getIngredientOptions(),
  ]);

  if (!recipe) notFound();

  return (
    <div>
      <PageHeader
        title={recipe.name}
        description="Editar receita"
        backHref="/admin/recipes"
      />
      <RecipeForm
        recipeId={recipe.id}
        initialName={recipe.name}
        initialYield={recipe.yieldQty}
        initialNotes={recipe.notes ?? ""}
        initialSteps={recipe.steps ? (recipe.steps as PartialBlock[]) : undefined}
        initialIngredients={recipe.ingredients}
        availableIngredients={ingredients}
      />
    </div>
  );
}
