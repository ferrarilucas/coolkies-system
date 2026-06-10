import { Carrot } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { getIngredientsWithLastCost } from "@/server/queries/ingredients";
import { IngredientDialog } from "@/components/ingredients/ingredient-dialog";
import { DeleteIngredientButton } from "@/components/ingredients/delete-ingredient-button";
import { formatBRL } from "@/lib/money";

const UNIT_ABBR: Record<string, string> = { G: "g", ML: "ml", UN: "un" };

export default async function IngredientsPage() {
  const ingredients = await getIngredientsWithLastCost();

  return (
    <div>
      <PageHeader
        title="Ingredientes"
        description="Itens usados nas receitas."
        backHref="/admin"
        action={<IngredientDialog mode="create" />}
      />

      {ingredients.length === 0 ? (
        <EmptyState
          icon={Carrot}
          title="Nenhum ingrediente"
          description="Cadastre os ingredientes que você usa nas receitas."
          action={<IngredientDialog mode="create" />}
        />
      ) : (
        <div className="space-y-2">
          {ingredients.map((ing) => {
            const abbr = UNIT_ABBR[ing.baseUnit] ?? ing.baseUnit.toLowerCase();

            return (
              <div
                key={ing.id}
                className="flex items-center justify-between rounded-lg border bg-card p-4 gap-3"
              >
                {/* Info principal */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{ing.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {abbr}
                    </Badge>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {ing.minStock != null && ing.minStock > 0 && (
                      <span>
                        Mínimo: {ing.minStock} {abbr}
                      </span>
                    )}
                    {ing.unitCostCents != null ? (
                      <span>
                        Custo atual:{" "}
                        <span className="tabular-nums font-medium text-foreground">
                          {formatBRL(ing.unitCostCents)}/{abbr}
                        </span>
                      </span>
                    ) : (
                      <span className="italic">Sem compra registrada</span>
                    )}
                  </div>
                </div>

                {/* Ações */}
                <div className="flex shrink-0 items-center gap-1">
                  <IngredientDialog
                    mode="edit"
                    ingredient={{
                      id: ing.id,
                      name: ing.name,
                      baseUnit: ing.baseUnit,
                      minStock: ing.minStock,
                    }}
                  />
                  <DeleteIngredientButton id={ing.id} name={ing.name} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
