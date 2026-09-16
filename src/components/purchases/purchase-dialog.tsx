"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { MoneyInput } from "@/components/shared/money-input";
import { createPurchase, fetchLastPriceForSupplierItem } from "@/server/actions/purchases";
import { PURCHASE_UNITS, UNIT_LABEL, bestInputUnit, toDisplayValue, type InputUnit } from "@/lib/units";
import { formatBRL } from "@/lib/money";
import { SupplierCombobox, type SupplierOption } from "./supplier-combobox";
import { PurchaseIngredientCombobox, type PurchaseIngredientOption } from "./ingredient-combobox";

type DraftItem = {
  key: string;
  ingredient: PurchaseIngredientOption | null;
  quantity: string;
  unit: InputUnit;
  unitPriceCents: number;
};

function emptyItem(): DraftItem {
  return { key: crypto.randomUUID(), ingredient: null, quantity: "", unit: "G", unitPriceCents: 0 };
}

function itemTotalCents(item: DraftItem): number {
  const qty = parseFloat(item.quantity);
  if (isNaN(qty) || qty <= 0) return 0;
  return Math.round(qty * item.unitPriceCents);
}

interface Props {
  suppliers: SupplierOption[];
  ingredients: PurchaseIngredientOption[];
}

export function PurchaseDialog({ suppliers, ingredients }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [allSuppliers, setAllSuppliers] = useState(suppliers);
  const [allIngredients, setAllIngredients] = useState(ingredients);
  const [supplier, setSupplier] = useState<SupplierOption | null>(null);
  const [purchasedAt, setPurchasedAt] = useState(format(new Date(), "yyyy-MM-dd"));
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);

  function resetForm() {
    setSupplier(null);
    setPurchasedAt(format(new Date(), "yyyy-MM-dd"));
    setItems([emptyItem()]);
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  async function handleIngredientChange(key: string, ing: PurchaseIngredientOption) {
    updateItem(key, { ingredient: ing });
    const last = await fetchLastPriceForSupplierItem(supplier?.id ?? null, ing.id);
    if (!last) return;
    const displayUnit = bestInputUnit(last.quantity, last.unit);
    const displayQty = toDisplayValue(last.quantity, displayUnit, last.unit);
    const unitPriceCents = displayQty > 0 ? Math.round(last.pricePaidCents / displayQty) : 0;
    updateItem(key, {
      ingredient: ing,
      quantity: String(displayQty),
      unit: displayUnit,
      unitPriceCents,
    });
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.key !== key) : prev));
  }

  const canSubmit =
    items.length > 0 &&
    items.every((i) => i.ingredient && parseFloat(i.quantity) > 0 && i.unitPriceCents > 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const fd = new FormData();
    fd.set("supplierId", supplier?.id ?? "");
    fd.set("purchasedAt", purchasedAt);
    fd.set(
      "items",
      JSON.stringify(
        items.map((i) => ({
          ingredientId: i.ingredient!.id,
          quantity: parseFloat(i.quantity),
          unit: i.unit,
          pricePaidCents: itemTotalCents(i),
        })),
      ),
    );

    startSave(async () => {
      const res = await createPurchase(fd);
      if (res.ok) {
        toast.success("Compra registrada.");
        setOpen(false);
        resetForm();
      } else {
        toast.error(res.error ?? "Erro ao registrar.");
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Registrar compra
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={[
            "inset-0 top-0 left-0 h-full max-h-screen w-full max-w-full translate-x-0 translate-y-0",
            "rounded-none overflow-y-auto",
            "sm:inset-auto sm:top-[50%] sm:left-[50%] sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-lg",
            "sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg",
          ].join(" ")}
        >
          <DialogHeader>
            <DialogTitle>Registrar compra</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Fornecedor</Label>
                <SupplierCombobox
                  value={supplier}
                  onChange={setSupplier}
                  options={allSuppliers}
                  onOptionCreated={(s) => setAllSuppliers((prev) => [...prev, s])}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="purchased-at">Data da compra</Label>
                <Input
                  id="purchased-at"
                  type="date"
                  value={purchasedAt}
                  onChange={(e) => setPurchasedAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.key} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <PurchaseIngredientCombobox
                        value={item.ingredient}
                        onChange={(ing) => handleIngredientChange(item.key, ing)}
                        options={allIngredients}
                        onOptionCreated={(ing) => setAllIngredients((prev) => [...prev, ing])}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => removeItem(item.key)}
                      disabled={items.length === 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min="0.001"
                      step="any"
                      placeholder="Qtd."
                      value={item.quantity}
                      onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                    />
                    <Select value={item.unit} onValueChange={(v) => updateItem(item.key, { unit: v as InputUnit })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PURCHASE_UNITS.map((u) => (
                          <SelectItem key={u} value={u}>{UNIT_LABEL[u]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Preço por {UNIT_LABEL[item.unit]}
                    </Label>
                    <MoneyInput
                      valueCents={item.unitPriceCents}
                      onChangeCents={(cents) => updateItem(item.key, { unitPriceCents: cents })}
                    />
                  </div>

                  <p className="text-right text-xs text-muted-foreground">
                    Total: <span className="font-medium text-foreground tabular-nums">{formatBRL(itemTotalCents(item))}</span>
                  </p>
                </div>
              ))}

              <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={addItem}>
                <Plus className="size-3.5" />
                Adicionar item
              </Button>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || !canSubmit}>
                {saving ? "Salvando…" : "Registrar compra"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
