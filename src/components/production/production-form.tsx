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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createProductionBatch, updateProductionBatch } from "@/server/actions/production";

interface Product { id: string; name: string }
interface Flavor { id: string; name: string; productId: string; fillingRecipeId: string | null }
interface Recipe { id: string; name: string; yieldQty: number }

interface Props {
  batchId?: string; // se presente, é edição
  products: Product[];
  flavors: Flavor[];
  recipes: Recipe[];
  initial?: {
    productId: string;
    flavorId: string | null;
    recipeId: string | null;
    quantity: number;
    notes: string;
    producedAt: string;
    fillings: { flavorId: string; quantity: number }[];
  };
}

type FillingLine = { key: string; flavorId: string; quantity: number };

const NO_RECIPE = "__none__";
const NO_FLAVOR = "__none__";

export function ProductionForm({ batchId, products, flavors, recipes, initial }: Props) {
  const router = useRouter();
  const [saving, startSave] = useTransition();

  const [productId, setProductId] = useState(
    initial?.productId ?? (products.length === 1 ? products[0].id : "")
  );
  const [flavorId, setFlavorId] = useState<string>(initial?.flavorId ?? NO_FLAVOR);
  const [recipeId, setRecipeId] = useState(initial?.recipeId ?? NO_RECIPE);
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 12));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [producedAt, setProducedAt] = useState(
    initial?.producedAt ?? format(new Date(), "yyyy-MM-dd")
  );
  const [fillings, setFillings] = useState<FillingLine[]>(
    initial?.fillings.map((f) => ({ ...f, key: crypto.randomUUID() })) ?? []
  );

  // Sabores do produto selecionado
  const productFlavors = flavors.filter((f) => f.productId === productId);
  // Sabores "base" = sem receita de recheio (ex: Tradicional)
  const baseFlavors = productFlavors.filter((f) => !f.fillingRecipeId);
  // Sabores com recheio = só aparecem na seção de recheios
  const flavorsWithFilling = productFlavors.filter((f) => f.fillingRecipeId);

  const selectedRecipe = recipeId !== NO_RECIPE ? recipes.find((r) => r.id === recipeId) : undefined;

  function handleProductChange(pid: string) {
    setProductId(pid);
    setFlavorId(NO_FLAVOR);
    setFillings([]);
  }

  function addFilling() {
    const available = flavorsWithFilling.filter(
      (f) => !fillings.some((l) => l.flavorId === f.id),
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
  // Quando há recheios, todos os cookies devem ser distribuídos
  const fillingsIncomplete = fillings.length > 0 && fillingsTotal < totalQty;
  const fillingsExceeded = fillingsTotal > totalQty;
  const selectedFillingIds = new Set(fillings.map((f) => f.flavorId));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) { toast.error("Selecione um produto."); return; }
    if (totalQty <= 0) { toast.error("Quantidade deve ser maior que zero."); return; }
    if (fillingsExceeded) { toast.error("Total de recheados excede a quantidade produzida."); return; }
    if (fillingsIncomplete) { toast.error(`Distribua todos os ${totalQty} cookies entre os recheios (faltam ${unfilled}).`); return; }

    const fd = new FormData();
    fd.set("productId", productId);
    fd.set("flavorId", flavorId === NO_FLAVOR ? "" : flavorId);
    fd.set("recipeId", recipeId === NO_RECIPE ? "" : recipeId);
    fd.set("quantity", String(totalQty));
    fd.set("notes", notes);
    fd.set("producedAt", producedAt);
    fd.set("fillings", JSON.stringify(
      fillings.filter((f) => f.quantity > 0).map(({ flavorId, quantity }) => ({ flavorId, quantity }))
    ));

    startSave(async () => {
      const res = batchId
        ? await updateProductionBatch(batchId, fd)
        : await createProductionBatch(fd);

      if (res.ok) {
        toast.success(batchId ? "Produção atualizada." : "Produção registrada.");
        router.push("/products");
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao salvar.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* ── Produção ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Produção</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Produto</Label>
            <Select value={productId} onValueChange={handleProductChange}>
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

          {/* Sabor base — só aparece se o produto tem sabores sem recheio */}
          {productId && baseFlavors.length > 0 && (
            <div className="space-y-2">
              <Label>
                Sabor <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Select value={flavorId} onValueChange={setFlavorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sabor…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FLAVOR}>Sem sabor específico</SelectItem>
                  {baseFlavors.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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

      {/* ── Recheios — só aparece se há sabores com recheio ──────────── */}
      {productId && flavorsWithFilling.length > 0 && (
        <>
          <Separator />
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Recheios
              </h2>
              {totalQty > 0 && (
                <span className="text-xs tabular-nums">
                  {fillingsExceeded ? (
                    <span className="text-destructive">Excede em {-unfilled}</span>
                  ) : fillingsIncomplete ? (
                    <span className="text-warning-foreground">{fillingsTotal}/{totalQty} distribuídos</span>
                  ) : fillingsTotal === totalQty ? (
                    <span className="text-success">Todos distribuídos ✓</span>
                  ) : (
                    <span className="text-muted-foreground">{fillingsTotal}/{totalQty} distribuídos</span>
                  )}
                </span>
              )}
            </div>

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
          </section>
        </>
      )}

      {/* ── Ações ─────────────────────────────────────────────────────── */}
      <div className="flex justify-end gap-3 pb-8">
        <Button type="button" variant="outline" onClick={() => router.push("/products")} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving || !productId || totalQty <= 0}>
          <ChefHat className="size-4" />
          {saving ? "Salvando…" : batchId ? "Salvar produção" : "Registrar produção"}
        </Button>
      </div>
    </form>
  );
}
