"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { formatQty } from "@/lib/units";
import { toggleShoppingListItem } from "@/server/actions/shopping-list";
import type { BaseUnit } from "@prisma/client";

export function ShoppingListItemRow({
  id,
  label,
  quantity,
  unit,
}: {
  id: string;
  label: string;
  quantity: number | null;
  unit: string | null;
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

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <Switch checked={false} disabled={pending} onCheckedChange={onCheckedChange} aria-label="Marcar como comprado" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        {quantity != null && unit != null && (
          <p className="text-xs text-muted-foreground">{formatQty(quantity, unit as BaseUnit)}</p>
        )}
      </div>
    </div>
  );
}
