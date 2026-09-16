import { PageHeader } from "@/components/shared/page-header";
import { RecipeForm } from "@/components/recipes/recipe-form";
import { getItemOptions } from "@/server/queries/recipes";

export default async function NewRecipePage() {
  const ingredients = await getItemOptions();

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
