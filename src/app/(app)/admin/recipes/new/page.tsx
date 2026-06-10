import { PageHeader } from "@/components/shared/page-header";
import { RecipeForm } from "@/components/recipes/recipe-form";
import { getIngredientOptions } from "@/server/queries/recipes";

export default async function NewRecipePage() {
  const ingredients = await getIngredientOptions();

  return (
    <div>
      <PageHeader
        title="Nova receita"
        backHref="/admin/recipes"
      />
      <RecipeForm availableIngredients={ingredients} />
    </div>
  );
}
