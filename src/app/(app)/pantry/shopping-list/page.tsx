import { ListChecks, ShoppingBasket } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { getPantryStock } from "@/server/queries/production";
import { formatQty, baseUnitLabel } from "@/lib/units";
import { formatBRL } from "@/lib/money";
import { BaseUnit } from "@prisma/client";

export default async function ShoppingListPage() {
  const stock = await getPantryStock();

  const toBuy = stock
    .filter((s) => s.belowMin && s.minStock != null)
    .map((s) => {
      const deficit = Math.max(0, (s.minStock ?? 0) - s.current);
      const estimatedCents =
        s.latestPriceCents != null ? Math.round(deficit * s.latestPriceCents) : null;
      return { ...s, deficit, estimatedCents };
    });

  const totalEstimatedCents = toBuy.reduce((sum, i) => sum + (i.estimatedCents ?? 0), 0);
  const hasEstimates = toBuy.some((i) => i.estimatedCents != null);

  return (
    <div>
      <PageHeader
        title="Lista de compras"
        description="Ingredientes abaixo do estoque mínimo."
        backHref="/pantry"
      />

      {toBuy.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nada para comprar"
          description="Nenhum ingrediente está abaixo do estoque mínimo. Defina o mínimo de cada ingrediente em Cadastros para gerar a lista automaticamente."
        />
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            {toBuy.map((item) => {
              const unit = item.baseUnit as BaseUnit;
              return (
                <div key={item.ingredientId} className="rounded-lg border bg-card px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.ingredientName}</p>
                      <p className="text-xs text-muted-foreground">
                        Atual {formatQty(Math.max(0, item.current), unit)} · mín{" "}
                        {formatQty(item.minStock ?? 0, unit)}
                        {item.latestMarket && item.latestPriceCents != null &&
                          ` · ${formatBRL(item.latestPriceCents)}/${baseUnitLabel(unit)} em ${item.latestMarket}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums">
                        {formatQty(item.deficit, unit)}
                      </p>
                      {item.estimatedCents != null && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          ≈ {formatBRL(item.estimatedCents)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {hasEstimates && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                <ShoppingBasket className="size-4 text-muted-foreground" />
                Custo estimado
              </span>
              <span className="font-bold tabular-nums">{formatBRL(totalEstimatedCents)}</span>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Estimativa baseada no último preço pago de cada ingrediente.
          </p>
        </div>
      )}
    </div>
  );
}
