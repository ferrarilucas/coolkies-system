"use client";

import { useTransition } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/money";
import { formatQty, baseUnitLabel } from "@/lib/units";
import { deletePurchase } from "@/server/actions/markets";
import type { PurchaseItem } from "@/server/queries/markets";

export function PurchasesList({ purchases }: { purchases: PurchaseItem[] }) {
  if (purchases.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhuma compra registrada.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {purchases.map((p) => (
        <PurchaseRow key={p.id} purchase={p} />
      ))}
    </div>
  );
}

function PurchaseRow({ purchase: p }: { purchase: PurchaseItem }) {
  const [deleting, startDelete] = useTransition();

  const pricePerUnit =
    p.quantity > 0
      ? (p.pricePaidCents / p.quantity).toFixed(2)
      : "—";

  const unitLabel = baseUnitLabel(p.ingredient.baseUnit);

  function handleDelete() {
    startDelete(async () => {
      const res = await deletePurchase(p.id);
      if (!res.ok) toast.error(res.error ?? "Erro ao excluir.");
    });
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0 space-y-1">
        {/* Linha 1: ingrediente + mercado */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{p.ingredient.name}</span>
          <Badge variant="secondary" className="text-xs">{p.market.name}</Badge>
        </div>
        {/* Linha 2: qtd + preço + $/unidade */}
        <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
          <span>{formatQty(p.quantity, p.ingredient.baseUnit)}</span>
          <span className="text-foreground font-medium tabular-nums">
            {formatBRL(p.pricePaidCents)}
          </span>
          <span className="text-xs">
            R$ {pricePerUnit}/{unitLabel}
          </span>
          <span className="text-xs">
            {format(p.purchasedAt, "d MMM yyyy", { locale: ptBR })}
          </span>
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
        onClick={handleDelete}
        disabled={deleting}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
