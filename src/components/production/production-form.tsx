"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Plus, Trash2, ChefHat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createProductionBatch } from "@/server/actions/production";

interface Product { id: string; name: string }
interface Flavor { id: string; name: string; productId: string; fillingRecipeId: string | null }
interface Recipe { id: string; name: string; yieldQty: number }

interface Props {
  products: Product[];
  flavors: Flavor[];
  recipes: Recipe[];
}

type FillingLine = { key: string; flavorId: string; quantity: number };

export function ProductionForm({ products, flavors, recipes }: Props) {
  const router = useRouter();
  const [saving, startSave] = useTransition();

  const [productId, setProductId] = useState(products.length === 1 ? products[0].id : "");
  const NO_RECIPE = "__none__";
  const [recipeId, setRecipeId] = useState(NO_RECIPE);
  const [quantity, setQuantity] = useState("12");
  const [notes, setNotes] = useState("");
  const [producedAt, setProducedAt] = useState(format(new Date(), "yyyy-MM-dd"));
  const [fillings, setFillings] = useState<FillingLine[]>([]);

  const productFlavors = flavors.filter((f) => f.productId === productId);
  const selectedRecipe = recipeId !== NO_RECIPE ? recipes.find((r) => r.id === recipeId) : undefined;

  function addFilling() {
    const available = productFlavors.filter(
      (f) => f.fillingRecipeId && !fillings.some((l) => l.flavorId === f.id),
    );
    if (available.length === 0) return;
    setFillings((prev) => [
      ...prev,
      { key: crypto.randomUUID(), flavorId: available[0].id, quantity: 0 },
    ]);
  }

  function removeFilling(key: string) {
    setFillings((prev) => prev.filter((l) => l.key !== key));
  }

  function updateFilling(key: string, patch: Partial<FillingLine>) {
    setFillings((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const totalQty = parseInt(quantity) || 0;
  const fillingsTotal = fillings.reduce((s, f) => s + (f.quantity || 0), 0);
  const unfilled = totalQty - fillingsTotal;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) { toast.error("Selecione um produto."); return; }
    if (totalQty <= 0) { toast.error("Quantidade deve ser maior que zero."); return; }
    if (fillingsTotal > totalQty) { toast.error("Total de recheados excede a quantidade produzida."); return; }

    const fd = new FormData();
    fd.set("productId", productId);
    fd.set("recipeId", recipeId === NO_RECIPE ? "" : recipeId);
    fd.set("quantity", String(totalQty));
    fd.set("notes", notes);
    fd.set("producedAt", producedAt);
    fd.set("fillings", JSON.stringify(
      fillings.filter((f) => f.quantity > 0).map(({ flavorId, quantity }) => ({ flavorId, quantity }))
    ));

    startSave(async () => {
      const res = await createProductionBatch(fd);
      if (res.ok) {
        toast.success("Produção registrada.");
        router.push("/products");
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao registrar.");
      }
    });
  }

  const flavorsWithFilling = productFlavors.filter((f) => f.fillingRecipeId);
  const selectedFillingIds = new Set(fillings.map((f) => f.flavorId));

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* Produto + Receita + Data */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Produção</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Produto</Label>
            <Select value={productId} onValueChange={(v) => { setProductId(v); setFillings([]); }}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o produto…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              Receita base <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Select value={recipeId} onValueChange={setRecipeId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a receita…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_RECIPE}>Sem receita</SelectItem>
                {recipes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} (rende {r.yieldQty})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="qty">Quantidade produzida</Label>
            <Input
              id="qty"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Ex.: 12"
            />
            {selectedRecipe && (
              <p className="text-xs text-muted-foreground">
                Equivale a {(totalQty / selectedRecipe.yieldQty).toFixed(1)} lote(s) da receita
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="produced-at">Data de produção</Label>
            <Input
              id="produced-at"
              type="date"
              value={producedAt}
              onChange={(e) => setProducedAt(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Observações <span className="text-muted-foreground">(opcional)</span></Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
      </section>

      <Separator />

      {/* Recheios */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Recheios
          </h2>
          {totalQty > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {unfilled >= 0
                ? `${unfilled} sem recheio · ${fillingsTotal} recheados`
                : <span className="text-destructive">Excede em {-unfilled}</span>}
            </span>
          )}
        </div>

        {flavorsWithFilling.length === 0 && productId ? (
          <p className="text-sm text-muted-foreground py-2">
            Nenhum sabor com receita de recheio cadastrada para este produto.{" "}
            Configure em <strong>Cadastros → Catálogo</strong>.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              {fillings.map((line) => (
                <div key={line.key} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2">
                  <Select
                    value={line.flavorId}
                    onValueChange={(v) => updateFilling(line.key, { flavorId: v })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {flavorsWithFilling.map((f) => (
                        <SelectItem
                          key={f.id}
                          value={f.id}
                          disabled={selectedFillingIds.has(f.id) && f.id !== line.flavorId}
                        >
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="0"
                    max={totalQty}
                    value={line.quantity || ""}
                    onChange={(e) => updateFilling(line.key, { quantity: parseInt(e.target.value) || 0 })}
                    placeholder="Qtd."
                    className="w-20 text-right tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">un.</span>
                  <button
                    type="button"
                    onClick={() => removeFilling(line.key)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            {flavorsWithFilling.length > fillings.length && (
              <Button type="button" variant="outline" className="w-full gap-2" onClick={addFilling}>
                <Plus className="size-4" />
                Adicionar recheio
              </Button>
            )}
          </>
        )}
      </section>

      {/* Ações */}
      <div className="flex justify-end gap-3 pb-8">
        <Button type="button" variant="outline" onClick={() => router.push("/products")} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving || !productId || totalQty <= 0}>
          <ChefHat className="size-4" />
          {saving ? "Registrando…" : "Registrar produção"}
        </Button>
      </div>
    </form>
  );
}
