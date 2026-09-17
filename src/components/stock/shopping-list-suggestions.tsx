"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addSuggestedItem } from "@/server/actions/shopping-list";
import { formatQty } from "@/lib/units";
import type { ShoppingListSuggestion } from "@/server/queries/shopping-list";
import type { BaseUnit } from "@prisma/client";

export function ShoppingListSuggestions({ suggestions }: { suggestions: ShoppingListSuggestion[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (suggestions.length === 0) return null;

  function onAdd(itemId: string) {
    startTransition(async () => {
      const res = await addSuggestedItem(itemId);
      if (!res.ok) toast.error(res.error ?? "Não foi possível adicionar.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Sugestões (estoque abaixo do mínimo)</h2>
      {suggestions.map((s) => (
        <div key={s.itemId} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{s.itemName}</p>
            <p className="text-xs text-muted-foreground">
              Faltam {formatQty(s.deficit, s.unit as BaseUnit)}
            </p>
          </div>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onAdd(s.itemId)}>
            <Plus className="size-4" />
            Adicionar
          </Button>
        </div>
      ))}
    </div>
  );
}
