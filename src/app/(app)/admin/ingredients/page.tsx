import { Carrot } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { getItemsWithLastCost } from "@/server/queries/items";
import { ItemDialog } from "@/components/items/item-dialog";
import { DeleteItemButton } from "@/components/items/delete-item-button";
import { formatBRL } from "@/lib/money";

const UNIT_ABBR: Record<string, string> = { G: "g", ML: "ml", UN: "un" };

export default async function IngredientsPage() {
  const items = await getItemsWithLastCost();

  return (
    <div>
      <PageHeader
        title="Insumos"
        description="Itens usados nas receitas ou comprados para revenda."
        backHref="/admin"
        action={<ItemDialog mode="create" />}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Carrot}
          title="Nenhum insumo"
          description="Cadastre os insumos que você usa nas receitas."
          action={<ItemDialog mode="create" />}
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const abbr = UNIT_ABBR[item.unit] ?? item.unit.toLowerCase();

            return (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border bg-card p-4 gap-3"
              >
                {/* Info principal */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {abbr}
                    </Badge>
                    {item.sellable && (
                      <Badge variant="secondary" className="text-xs">
                        Venda
                      </Badge>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {item.minStock != null && item.minStock > 0 && (
                      <span>
                        Mínimo: {item.minStock} {abbr}
                      </span>
                    )}
                    {item.unitCostCents != null ? (
                      <span>
                        Custo atual:{" "}
                        <span className="tabular-nums font-medium text-foreground">
                          {formatBRL(item.unitCostCents)}/{abbr}
                        </span>
                      </span>
                    ) : (
                      <span className="italic">Sem compra registrada</span>
                    )}
                  </div>
                </div>

                {/* Ações */}
                <div className="flex shrink-0 items-center gap-1">
                  <ItemDialog
                    mode="edit"
                    item={{
                      id: item.id,
                      name: item.name,
                      unit: item.unit,
                      minStock: item.minStock,
                      productionInput: item.productionInput,
                      sellable: item.sellable,
                    }}
                  />
                  <DeleteItemButton id={item.id} name={item.name} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
