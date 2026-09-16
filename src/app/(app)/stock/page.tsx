import Link from "next/link";
import { AlertTriangle, ListChecks, PackageOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getItemStock } from "@/server/queries/production";
import { formatQty, baseUnitLabel } from "@/lib/units";
import { BaseUnit } from "@prisma/client";

export default async function StockPage() {
  const stock = await getItemStock();

  const alerts = stock.filter((s) => s.belowMin);

  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Estoque atual de itens calculado a partir das compras e produções."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/stock/shopping-list">
              <ListChecks />
              Lista de compras
            </Link>
          </Button>
        }
      />

      {alerts.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 text-warning-text shrink-0" />
            <span>
              <span className="font-semibold">{alerts.length}</span>{" "}
              {alerts.length === 1 ? "item abaixo do mínimo" : "itens abaixo do mínimo"}
            </span>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href="/stock/shopping-list">Ver lista</Link>
          </Button>
        </div>
      )}

      {stock.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="Estoque vazio"
          description="Registre compras em Compras para ver o estoque aqui."
        />
      ) : (
        <div className="space-y-2">
          {stock.map((entry) => (
            <StockRow key={`${entry.itemId}-${entry.variantId ?? ""}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function StockRow({ entry }: { entry: Awaited<ReturnType<typeof getItemStock>>[number] }) {
  const unit = entry.unit as BaseUnit;
  const currentFormatted = formatQty(Math.max(0, entry.current), unit);
  const unitLabel = baseUnitLabel(unit);
  const displayName = entry.variantName
    ? `${entry.itemName} — ${entry.variantName}`
    : entry.itemName;

  return (
    <div className={`rounded-lg border bg-card px-4 py-3 space-y-2 ${entry.belowMin ? "border-warning/60" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{displayName}</span>
          {entry.belowMin && (
            <Badge className="text-xs bg-warning/15 text-warning-text border-warning/30 gap-1">
              <AlertTriangle className="size-3" />
              Baixo
            </Badge>
          )}
        </div>
        <span
          className={`text-xl font-bold tabular-nums ${
            entry.current < 0
              ? "text-destructive"
              : entry.belowMin
                ? "text-warning-text"
                : entry.current === 0
                  ? "text-muted-foreground"
                  : ""
          }`}
        >
          {currentFormatted}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-1.5">
          {entry.sellable && <Badge variant="secondary" className="text-xs">Venda</Badge>}
          {entry.productionInput && <Badge variant="secondary" className="text-xs">Insumo</Badge>}
        </div>
        {entry.latestPriceCents !== null && entry.latestSupplier && (
          <span>
            R$ {(entry.latestPriceCents / 100).toFixed(2)}/{unitLabel} · {entry.latestSupplier}
          </span>
        )}
      </div>

      {entry.minStock != null && entry.minStock > 0 && (
        <p className="text-xs text-muted-foreground">
          Mínimo: {formatQty(entry.minStock, unit)}
        </p>
      )}
    </div>
  );
}
