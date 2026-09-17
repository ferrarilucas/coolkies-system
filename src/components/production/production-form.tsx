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

interface Item { id: string; name: string }
interface Variant { id: string; name: string; itemId: string; recipeId: string | null }
interface Recipe { id: string; name: string; yieldQty: number }

interface Props {
  batchId?: string;
  items: Item[];
  variants: Variant[];
  recipes: Recipe[];
  initial?: {
    itemId: string;
    recipeId: string | null;
    quantity: number;
    notes: string;
    producedAt: string;
    fillings: { variantId: string; quantity: number }[];
  };
}

type VariantLine = { key: string; variantId: string; quantity: number };

const NO_RECIPE = "__none__";

export function ProductionForm({ batchId, items, variants, recipes, initial }: Props) {
  const router = useRouter();
  const [saving, startSave] = useTransition();

  const [itemId, setItemId] = useState(
    initial?.itemId ?? (items.length === 1 ? items[0].id : "")
  );
  const [recipeId, setRecipeId] = useState(initial?.recipeId ?? NO_RECIPE);
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 12));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [producedAt, setProducedAt] = useState(
    initial?.producedAt ?? format(new Date(), "yyyy-MM-dd")
  );
  const [variantLines, setVariantLines] = useState<VariantLine[]>(
    initial?.fillings.map((f) => ({ ...f, key: crypto.randomUUID() })) ?? []
  );

  // Todas as variantes do item — qualquer uma pode ser distribuída
  const itemVariants = variants.filter((v) => v.itemId === itemId);
  const selectedRecipe = recipeId !== NO_RECIPE ? recipes.find((r) => r.id === recipeId) : undefined;

  function handleItemChange(id: string) {
    setItemId(id);
    setVariantLines([]);
  }

  function addVariantLine() {
    const available = itemVariants.filter(
      (v) => !variantLines.some((l) => l.variantId === v.id),
    );
    if (available.length === 0) return;
    setVariantLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), variantId: available[0].id, quantity: 0 },
    ]);
  }

  function removeVariantLine(key: string) {
    setVariantLines((prev) => prev.filter((l) => l.key !== key));
  }

  function updateVariantLine(key: string, patch: Partial<VariantLine>) {
    setVariantLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const totalQty = parseInt(quantity) || 0;
  const variantLinesTotal = variantLines.reduce((s, f) => s + (f.quantity || 0), 0);
  const variantLinesIncomplete = variantLines.length > 0 && variantLinesTotal < totalQty;
  const variantLinesExceeded = variantLinesTotal > totalQty;
  const selectedVariantIds = new Set(variantLines.map((f) => f.variantId));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId) { toast.error("Selecione um item."); return; }
    if (totalQty <= 0) { toast.error("Quantidade deve ser maior que zero."); return; }
    if (variantLinesExceeded) { toast.error("Total de variantes excede a quantidade produzida."); return; }
    if (variantLinesIncomplete) { toast.error(`Distribua todos os ${totalQty} cookies entre as variantes (faltam ${totalQty - variantLinesTotal}).`); return; }

    const fd = new FormData();
    fd.set("itemId", itemId);
    fd.set("recipeId", recipeId === NO_RECIPE ? "" : recipeId);
    fd.set("quantity", String(totalQty));
    fd.set("notes", notes);
    fd.set("producedAt", producedAt);
    fd.set("variantLines", JSON.stringify(
      variantLines.filter((f) => f.quantity > 0).map(({ variantId, quantity }) => ({ variantId, quantity }))
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
            <Label>Item</Label>
            <Select value={itemId} onValueChange={handleItemChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o item…" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
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

      {/* ── Distribuição por variante ─────────────────────────────────── */}
      {itemId && (
        <>
          <Separator />
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Variantes
              </h2>
              {totalQty > 0 && variantLines.length > 0 && (
                <span className="text-xs tabular-nums">
                  {variantLinesExceeded ? (
                    <span className="text-destructive">Excede em {variantLinesTotal - totalQty}</span>
                  ) : variantLinesTotal === totalQty ? (
                    <span className="text-success">Todos distribuídos ✓</span>
                  ) : (
                    <span className="text-warning-text">{variantLinesTotal}/{totalQty} distribuídos</span>
                  )}
                </span>
              )}
            </div>

            {itemVariants.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                Nenhuma variante cadastrada para este item.{" "}
                Configure em <strong>Cadastros → Catálogo</strong>.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {variantLines.map((line) => (
                    <div key={line.key} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2">
                      <Select
                        value={line.variantId}
                        onValueChange={(v) => updateVariantLine(line.key, { variantId: v })}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {itemVariants.map((v) => (
                            <SelectItem
                              key={v.id}
                              value={v.id}
                              disabled={selectedVariantIds.has(v.id) && v.id !== line.variantId}
                            >
                              {v.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min="0"
                        max={totalQty}
                        value={line.quantity || ""}
                        onChange={(e) => updateVariantLine(line.key, { quantity: parseInt(e.target.value) || 0 })}
                        placeholder="Qtd."
                        className="w-20 text-right tabular-nums"
                      />
                      <span className="text-xs text-muted-foreground shrink-0">un.</span>
                      <button
                        type="button"
                        onClick={() => removeVariantLine(line.key)}
                        className="flex h-10 w-10 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>

                {itemVariants.length > variantLines.length && (
                  <Button type="button" variant="outline" className="w-full gap-2" onClick={addVariantLine}>
                    <Plus className="size-4" />
                    Adicionar variante
                  </Button>
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* ── Ações ─────────────────────────────────────────────────────── */}
      <div className="flex justify-end gap-3 pb-8">
        <Button type="button" variant="outline" onClick={() => router.push("/products")} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving || !itemId || totalQty <= 0}>
          <ChefHat className="size-4" />
          {saving ? "Salvando…" : batchId ? "Salvar produção" : "Registrar produção"}
        </Button>
      </div>
    </form>
  );
}
