"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
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
import { createPurchase } from "@/server/actions/markets";
import { PURCHASE_UNITS, UNIT_LABEL, type InputUnit } from "@/lib/units";

interface Market { id: string; name: string }
interface Ingredient { id: string; name: string }

interface Props {
  markets: Market[];
  ingredients: Ingredient[];
}

export function PurchaseDialog({ markets, ingredients }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [marketId, setMarketId] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [unit, setUnit] = useState<InputUnit>("G");
  const [priceCents, setPriceCents] = useState(0);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("marketId", marketId);
    fd.set("ingredientId", ingredientId);
    fd.set("unit", unit);
    fd.set("pricePaidCents", String(priceCents));

    startSave(async () => {
      const res = await createPurchase(fd);
      if (res.ok) {
        toast.success("Compra registrada.");
        setOpen(false);
        // reset
        setMarketId("");
        setIngredientId("");
        setUnit("G");
        setPriceCents(0);
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar compra</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Mercado */}
            <div className="space-y-2">
              <Label>Mercado</Label>
              <Select value={marketId} onValueChange={setMarketId} required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o mercado…" />
                </SelectTrigger>
                <SelectContent>
                  {markets.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Ingrediente */}
            <div className="space-y-2">
              <Label>Ingrediente</Label>
              <Select value={ingredientId} onValueChange={setIngredientId} required>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o ingrediente…" />
                </SelectTrigger>
                <SelectContent>
                  {ingredients.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quantidade + Unidade */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="qty">Quantidade</Label>
                <Input
                  id="qty"
                  name="quantity"
                  type="number"
                  min="0.001"
                  step="any"
                  placeholder="Ex.: 1"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Unidade</Label>
                <Select value={unit} onValueChange={(v) => setUnit(v as InputUnit)}>
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
            </div>

            {/* Preço pago */}
            <div className="space-y-2">
              <Label>Preço total pago</Label>
              <MoneyInput
                valueCents={priceCents}
                onChangeCents={setPriceCents}
                autoFocus={false}
              />
            </div>

            {/* Data */}
            <div className="space-y-2">
              <Label htmlFor="purchased-at">Data da compra</Label>
              <Input
                id="purchased-at"
                name="purchasedAt"
                type="date"
                defaultValue={format(new Date(), "yyyy-MM-dd")}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving || !marketId || !ingredientId || priceCents === 0}
              >
                {saving ? "Salvando…" : "Registrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
