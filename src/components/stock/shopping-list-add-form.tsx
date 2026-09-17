"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createShoppingListItem } from "@/server/actions/shopping-list";
import { PurchaseItemCombobox, type PurchaseItemOption } from "@/components/purchases/item-combobox";
import { baseUnitLabel } from "@/lib/units";
import type { BaseUnit } from "@prisma/client";

const FREE_TEXT_UNITS: BaseUnit[] = ["G", "ML", "UN"];
const NO_UNIT = "__none__";

export function ShoppingListAddForm({ items }: { items: PurchaseItemOption[] }) {
  const router = useRouter();
  const [allItems, setAllItems] = useState<PurchaseItemOption[]>(items);
  const [selectedItem, setSelectedItem] = useState<PurchaseItemOption | null>(null);
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("");
  const [freeTextUnit, setFreeTextUnit] = useState(NO_UNIT);
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
    fd.set("quantity", quantity.trim());
    if (selectedItem) {
      fd.set("itemId", selectedItem.id);
      fd.set("unit", selectedItem.unit);
    } else if (freeTextUnit !== NO_UNIT) {
      fd.set("unit", freeTextUnit);
    }
    startTransition(async () => {
      const res = await createShoppingListItem(fd);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível adicionar.");
        return;
      }
      setLabel("");
      setSelectedItem(null);
      setQuantity("");
      setFreeTextUnit(NO_UNIT);
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="shopping-list-quantity" className="text-xs text-muted-foreground">
            Quantidade (opcional)
          </Label>
          <Input
            id="shopping-list-quantity"
            type="number"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Ex.: 500"
            disabled={pending}
          />
        </div>
        {selectedItem ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Unidade</Label>
            <Input value={baseUnitLabel(selectedItem.unit as BaseUnit)} disabled readOnly />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Unidade</Label>
            <Select value={freeTextUnit} onValueChange={setFreeTextUnit} disabled={pending}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_UNIT}>Sem unidade</SelectItem>
                {FREE_TEXT_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>{baseUnitLabel(u)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending || !label.trim()}>
          <Plus className="size-4" />
          Adicionar
        </Button>
      </div>
    </form>
  );
}
