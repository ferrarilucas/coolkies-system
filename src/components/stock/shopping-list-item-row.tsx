"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Trash2, ShoppingCart } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { formatQty } from "@/lib/units";
import { toggleShoppingListItem, deleteShoppingListItem } from "@/server/actions/shopping-list";
import type { BaseUnit } from "@prisma/client";

export function ShoppingListItemRow({
  id, itemId, label, quantity, unit,
}: {
  id: string; itemId: string | null; label: string; quantity: number | null; unit: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onCheckedChange(checked: boolean) {
    startTransition(async () => {
      const res = await toggleShoppingListItem(id, checked);
      if (!res.ok) toast.error(res.error ?? "Não foi possível atualizar o item.");
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const res = await deleteShoppingListItem(id);
      if (!res.ok) toast.error(res.error ?? "Não foi possível remover o item.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <Switch checked={false} disabled={pending} onCheckedChange={onCheckedChange} aria-label="Marcar como comprado" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        {quantity != null && unit != null && (
          <p className="text-xs text-muted-foreground">{formatQty(quantity, unit as BaseUnit)}</p>
        )}
      </div>
      {itemId && (
        <Button asChild size="icon" variant="ghost" title="Registrar compra">
          <Link href={`/purchases?itemId=${itemId}`}><ShoppingCart className="size-4" /></Link>
        </Button>
      )}
      <Button size="icon" variant="ghost" disabled={pending} onClick={onDelete} title="Remover">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
