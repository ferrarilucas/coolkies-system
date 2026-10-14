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
import {
  PURCHASE_UNITS, UNIT_LABEL, bestInputUnit, formatUnitPrice, toBaseUnit, toDisplayValue, type InputUnit,
} from "@/lib/units";
import { convertPriceMode, lineTotalCents, type PriceMode } from "@/lib/purchase-price";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { SupplierCombobox, type SupplierOption } from "./supplier-combobox";
import { PurchaseItemCombobox, type PurchaseItemOption } from "./item-combobox";

type DraftItem = {
  key: string;
  item: PurchaseItemOption | null;
  variantId: string | null;
  quantity: string;
  unit: InputUnit;
  priceMode: PriceMode;
  /** Valor total ou preço por unidade, conforme `priceMode` */
  priceCents: number;
};

function emptyItem(): DraftItem {
  return {
    key: crypto.randomUUID(), item: null, variantId: null, quantity: "", unit: "G",
    priceMode: "TOTAL", priceCents: 0,
  };
}

function parseQty(raw: string): number {
  const qty = parseFloat(raw.replace(",", "."));
  return isNaN(qty) ? 0 : qty;
}

function itemTotalCents(item: DraftItem): number {
  return lineTotalCents(item.priceMode, item.priceCents, parseQty(item.quantity));
}

interface Props {
  suppliers: SupplierOption[];
  ingredients: PurchaseItemOption[];
}

export function PurchaseDialog({ suppliers, ingredients }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [allSuppliers, setAllSuppliers] = useState(suppliers);
  const [allItems, setAllItems] = useState(ingredients);
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

  async function applyLastPrice(key: string, itemId: string, variantId: string | null) {
    const last = await fetchLastPriceForSupplierItem(supplier?.id ?? null, itemId, variantId);
    if (!last) return;
    const displayUnit = bestInputUnit(last.quantity, last.unit);
    const displayQty = toDisplayValue(last.quantity, displayUnit, last.unit);
    setItems((prev) =>
      prev.map((i) =>
        i.key === key
          ? {
              ...i,
              quantity: String(displayQty),
              unit: displayUnit,
              priceCents: convertPriceMode("TOTAL", i.priceMode, last.pricePaidCents, displayQty),
            }
          : i,
      ),
    );
  }

  async function handleItemChange(key: string, item: PurchaseItemOption) {
    updateItem(key, { item, variantId: null });
    if (item.variants.length === 0) {
      await applyLastPrice(key, item.id, null);
    }
  }

  async function handleVariantChange(key: string, item: PurchaseItemOption, variantId: string) {
    updateItem(key, { variantId });
    await applyLastPrice(key, item.id, variantId);
  }

  function setPriceMode(item: DraftItem, mode: PriceMode) {
    updateItem(item.key, {
      priceMode: mode,
      priceCents: convertPriceMode(item.priceMode, mode, item.priceCents, parseQty(item.quantity)),
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
    items.every(
      (i) =>
        i.item &&
        parseQty(i.quantity) > 0 &&
        itemTotalCents(i) > 0 &&
        (i.item.variants.length === 0 || i.variantId),
    );

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
          itemId: i.item!.id,
          variantId: i.variantId,
          quantity: parseQty(i.quantity),
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
                      <PurchaseItemCombobox
                        value={item.item}
                        onChange={(v) => handleItemChange(item.key, v)}
                        options={allItems}
                        onOptionCreated={(v) => setAllItems((prev) => [...prev, v])}
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

                  {item.item && item.item.variants.length > 0 && (
                    <Select
                      value={item.variantId ?? ""}
                      onValueChange={(v) => handleVariantChange(item.key, item.item!, v)}
                    >
                      <SelectTrigger className={!item.variantId ? "text-muted-foreground" : undefined}>
                        <SelectValue placeholder="Selecione a variante…" />
                      </SelectTrigger>
                      <SelectContent>
                        {item.item.variants.map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

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
                    <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1" role="radiogroup" aria-label="Como informar o preço">
                      {(["TOTAL", "UNIT"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={item.priceMode === mode}
                          onClick={() => setPriceMode(item, mode)}
                          className={cn(
                            "h-8 rounded px-2 text-xs font-medium transition-colors",
                            item.priceMode === mode
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {mode === "TOTAL" ? "Valor pago" : `Preço por ${UNIT_LABEL[item.unit]}`}
                        </button>
                      ))}
                    </div>
                    <MoneyInput
                      aria-label={item.priceMode === "TOTAL" ? "Valor pago" : `Preço por ${UNIT_LABEL[item.unit]}`}
                      valueCents={item.priceCents}
                      onChangeCents={(cents) => updateItem(item.key, { priceCents: cents })}
                    />
                  </div>

                  <PriceSummary item={item} />
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

function PriceSummary({ item }: { item: DraftItem }) {
  const qty = parseQty(item.quantity);
  const total = itemTotalCents(item);
  if (!item.item || qty <= 0 || total <= 0) return null;
  const base = toBaseUnit(qty, item.unit);
  return (
    <p className="flex justify-between gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums">{formatUnitPrice(total, base.quantity, base.unit)}</span>
      <span>
        Total: <span className="font-medium text-foreground tabular-nums">{formatBRL(total)}</span>
      </span>
    </p>
  );
}
