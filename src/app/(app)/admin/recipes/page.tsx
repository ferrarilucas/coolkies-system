import Link from "next/link";
import { ChefHat, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getRecipesWithCost } from "@/server/queries/recipes";
import { DeleteRecipeButton } from "@/components/recipes/delete-recipe-button";
import { formatBRL } from "@/lib/money";

export default async function RecipesPage() {
  const recipes = await getRecipesWithCost();

  return (
    <div>
      <PageHeader
        title="Receitas"
        description="Ingredientes, passo a passo e custo estimado."
        backHref="/admin"
        action={
          <Button size="sm" asChild>
            <Link href="/admin/recipes/new">
              <Plus />
              Nova receita
            </Link>
          </Button>
        }
      />

      {recipes.length === 0 ? (
        <EmptyState
          icon={ChefHat}
          title="Nenhuma receita"
          description="Crie sua primeira receita com passo a passo e cálculo de custo."
          action={
            <Button asChild>
              <Link href="/admin/recipes/new">
                <Plus />
                Nova receita
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {recipes.map((recipe) => (
            <div
              key={recipe.id}
              className="flex items-center justify-between rounded-lg border bg-card p-4 gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{recipe.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    rende {recipe.yieldQty} un.
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span>
                    {recipe.ingredientCount} ingrediente{recipe.ingredientCount !== 1 ? "s" : ""}
                  </span>
                  {recipe.costPerUnitCents != null ? (
                    <span>
                      Custo:{" "}
                      <span className="tabular-nums font-medium text-foreground">
                        {formatBRL(Math.round(recipe.totalCostCents!))} total ·{" "}
                        {formatBRL(Math.round(recipe.costPerUnitCents))}/un
                      </span>
                    </span>
                  ) : recipe.ingredientCount > 0 ? (
                    <span className="italic">Custo parcial (faltam compras)</span>
                  ) : null}
                  {recipe.notes && (
                    <span className="truncate max-w-xs">{recipe.notes}</span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <Link href={`/admin/recipes/${recipe.id}/edit`}>
                    <Pencil className="size-4" />
                    <span className="sr-only">Editar</span>
                  </Link>
                </Button>
                <DeleteRecipeButton id={recipe.id} name={recipe.name} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
