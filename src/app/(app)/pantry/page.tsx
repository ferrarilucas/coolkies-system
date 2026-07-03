import Link from "next/link";
import { AlertTriangle, ListChecks, PackageOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPantryStock } from "@/server/queries/production";
import { formatQty, baseUnitLabel } from "@/lib/units";
import { BaseUnit } from "@prisma/client";

export default async function PantryPage() {
  const stock = await getPantryStock();

  const alerts = stock.filter((s) => s.belowMin);

  return (
    <div>
      <PageHeader
        title="Despensa"
        description="Estoque atual de ingredientes calculado a partir das compras e produções."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/pantry/shopping-list">
              <ListChecks />
              Lista de compras
            </Link>
          </Button>
        }
      />

      {alerts.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
          <AlertTriangle className="size-4 text-warning mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-medium">Estoque baixo: </span>
            {alerts.map((a) => a.ingredientName).join(", ")}
          </div>
        </div>
      )}

      {stock.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="Despensa vazia"
          description="Registre compras de ingredientes em Mercados e preços para ver o estoque aqui."
        />
      ) : (
        <div className="space-y-2">
          {stock.map((entry) => (
            <PantryRow key={entry.ingredientId} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function PantryRow({ entry }: { entry: Awaited<ReturnType<typeof getPantryStock>>[number] }) {
  const unit = entry.baseUnit as BaseUnit;
  const currentFormatted = formatQty(Math.max(0, entry.current), unit);
  const purchasedFormatted = formatQty(entry.purchased, unit);
  const consumedFormatted = formatQty(entry.consumed, unit);
  const unitLabel = baseUnitLabel(unit);

  const pct =
    entry.purchased > 0
      ? Math.min(100, Math.max(0, (entry.current / entry.purchased) * 100))
      : 0;

  return (
    <div className={`rounded-lg border bg-card px-4 py-3 space-y-2 ${entry.belowMin ? "border-warning/60" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{entry.ingredientName}</span>
          {entry.belowMin && (
            <Badge className="text-xs bg-warning/15 text-warning-foreground border-warning/30 gap-1">
              <AlertTriangle className="size-3" />
              Baixo
            </Badge>
          )}
        </div>
        <span className={`text-xl font-bold tabular-nums ${entry.current <= 0 ? "text-destructive" : ""}`}>
          {currentFormatted}
        </span>
      </div>

      {/* Barra de progresso */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${entry.belowMin ? "bg-warning" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex gap-3">
          <span>↑ {purchasedFormatted} comprado</span>
          <span>↓ {consumedFormatted} usado</span>
        </div>
        {entry.latestPriceCents !== null && entry.latestMarket && (
          <span>
            R$ {(entry.latestPriceCents / 100).toFixed(2)}/{unitLabel} · {entry.latestMarket}
          </span>
        )}
      </div>

      {entry.minStock != null && (
        <p className="text-xs text-muted-foreground">
          Mínimo: {formatQty(entry.minStock, unit)}
        </p>
      )}
    </div>
  );
}
