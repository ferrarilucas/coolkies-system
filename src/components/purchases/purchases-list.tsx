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
import { deletePurchase } from "@/server/actions/purchases";
import type { PurchaseListItem } from "@/server/queries/purchases";

export function PurchasesList({ purchases }: { purchases: PurchaseListItem[] }) {
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

function PurchaseRow({ purchase }: { purchase: PurchaseListItem }) {
  const [deleting, startDelete] = useTransition();
  const totalCents = purchase.items.reduce((s, i) => s + i.pricePaidCents, 0);

  function handleDelete() {
    startDelete(async () => {
      const res = await deletePurchase(purchase.id);
      if (!res.ok) toast.error(res.error ?? "Erro ao excluir.");
    });
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {purchase.supplier ? (
            <Badge variant="secondary" className="text-xs">{purchase.supplier.name}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Sem fornecedor</span>
          )}
          <span className="text-xs text-muted-foreground">
            {format(purchase.purchasedAt, "d MMM yyyy", { locale: ptBR })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium tabular-nums">{formatBRL(totalCents)}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        {purchase.items.map((item) => {
          const pricePerUnit = item.quantity > 0 ? (item.pricePaidCents / item.quantity / 100).toFixed(2) : "—";
          const unitLabel = baseUnitLabel(item.item.unit);
          return (
            <div key={item.id} className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground pl-1">
              <span className="text-foreground">{item.item.name}</span>
              <span>{formatQty(item.quantity, item.item.unit)}</span>
              <span className="text-foreground tabular-nums">{formatBRL(item.pricePaidCents)}</span>
              <span className="text-xs">R$ {pricePerUnit}/{unitLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
