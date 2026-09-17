"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createShoppingListItem } from "@/server/actions/shopping-list";
import { PurchaseItemCombobox, type PurchaseItemOption } from "@/components/purchases/item-combobox";

export function ShoppingListAddForm({ items }: { items: PurchaseItemOption[] }) {
  const router = useRouter();
  const [allItems, setAllItems] = useState<PurchaseItemOption[]>(items);
  const [selectedItem, setSelectedItem] = useState<PurchaseItemOption | null>(null);
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSelectItem(item: PurchaseItemOption) {
    setSelectedItem(item);
    setLabel(item.name);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    const fd = new FormData();
    fd.set("label", label.trim());
    if (selectedItem) {
      fd.set("itemId", selectedItem.id);
      fd.set("unit", selectedItem.unit);
    }
    startTransition(async () => {
      const res = await createShoppingListItem(fd);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível adicionar.");
        return;
      }
      setLabel("");
      setSelectedItem(null);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Item cadastrado (opcional)</Label>
          <PurchaseItemCombobox
            value={selectedItem}
            onChange={handleSelectItem}
            options={allItems}
            onOptionCreated={(item) => setAllItems((prev) => [...prev, item])}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shopping-list-label" className="text-xs text-muted-foreground">
            Descrição
          </Label>
          <Input
            id="shopping-list-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Adicionar item… (ex.: café de casa)"
            disabled={pending}
          />
        </div>
      </div>

      {selectedItem && (
        <button
          type="button"
          onClick={() => setSelectedItem(null)}
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          Não vincular a um item cadastrado
        </button>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending || !label.trim()}>
          <Plus className="size-4" />
          Adicionar
        </Button>
      </div>
    </form>
  );
}
