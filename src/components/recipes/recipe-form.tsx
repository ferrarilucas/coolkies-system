"use client";

import { useState, useTransition, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, ChefHat } from "lucide-react";
import type { Block, PartialBlock } from "@blocknote/core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { IngredientCombobox } from "./ingredient-combobox";

import { saveRecipe } from "@/server/actions/recipes";
import { formatBRL } from "@/lib/money";
import { recipeUnitsFor, toBaseUnit, UNIT_LABEL_SHORT, type InputUnit } from "@/lib/units";
import { BaseUnit } from "@prisma/client";

const BlockEditor = dynamic(
  () => import("@/components/shared/block-editor").then((m) => m.BlockEditor),
  { ssr: false, loading: () => <div className="h-40 animate-pulse rounded-md bg-muted" /> },
);

export type IngredientOption = {
  id: string;
  name: string;
  baseUnit: string;
  unitCostCents: number | null;
};

type IngredientLine = {
  key: string;
  ingredient: IngredientOption | null;
  quantity: string;
  inputUnit: InputUnit;
};

type InitialIngredient = {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  quantity: number;
  unitCostCents: number | null;
};

interface Props {
  recipeId?: string;
  initialName?: string;
  initialYield?: number;
  initialNotes?: string;
  initialSteps?: PartialBlock[];
  initialIngredients?: InitialIngredient[];
  availableIngredients: IngredientOption[];
}

function newKey() { return crypto.randomUUID(); }
function blankLine(): IngredientLine { return { key: newKey(), ingredient: null, quantity: "", inputUnit: "G" }; }

export function RecipeForm({
  recipeId,
  initialName = "",
  initialYield = 12,
  initialNotes = "",
  initialSteps,
  initialIngredients = [],
  availableIngredients,
}: Props) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  // ── Campos básicos ────────────────────────────────────────────────────────
  const [name, setName] = useState(initialName);
  const [yieldQty, setYieldQty] = useState(String(initialYield));
  const [notes, setNotes] = useState(initialNotes);
  const stepsRef = useRef<Block[]>([]);

  // ── Ingredientes ──────────────────────────────────────────────────────────
  const [allIngredients, setAllIngredients] = useState<IngredientOption[]>(availableIngredients);

  const [lines, setLines] = useState<IngredientLine[]>(() => {
    if (initialIngredients.length > 0) {
      return initialIngredients.map((i) => ({
        key: crypto.randomUUID(),
        ingredient: {
          id: i.ingredientId,
          name: i.ingredientName,
          baseUnit: i.baseUnit,
          unitCostCents: i.unitCostCents,
        },
        quantity: String(i.quantity),
        inputUnit: i.baseUnit as InputUnit,
      }));
    }
    return [blankLine()];
  });

  function updateLine(key: string, patch: Partial<IngredientLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /**
   * Quando o ingrediente muda, atualiza a linha E troca o key para o id do ingrediente.
   * Isso garante: (1) unicidade do key, (2) React recria o combobox (fecha e limpa estado).
   */
  function setLineIngredient(currentKey: string, ing: IngredientOption) {
    setLines((prev) =>
      prev.map((l) =>
        l.key === currentKey
          ? { ...l, key: ing.id, ingredient: ing, inputUnit: ing.baseUnit as InputUnit }
          : l,
      ),
    );
  }

  function removeLine(key: string) {
    setLines((prev) => {
      const next = prev.filter((l) => l.key !== key);
      return next.length === 0 ? [blankLine()] : next;
    });
  }

  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }

  function handleIngredientCreated(ing: IngredientOption) {
    // Deduplicação: não adiciona se já existe na lista
    setAllIngredients((prev) => {
      if (prev.some((i) => i.id === ing.id)) return prev;
      return [...prev, ing].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  // ── Custo estimado ────────────────────────────────────────────────────────
  const yieldNum = parseInt(yieldQty) || 1;
  const filledLines = lines.filter((l) => l.ingredient !== null);
  let totalCostCents = 0;
  let costComplete = filledLines.length > 0;
  for (const l of filledLines) {
    const rawQty = parseFloat(l.quantity.replace(",", ".")) || 0;
    const base = l.ingredient!.baseUnit as BaseUnit;
    const { quantity: qtyInBase } = toBaseUnit(rawQty, l.inputUnit, base);
    if (l.ingredient!.unitCostCents == null) { costComplete = false; continue; }
    totalCostCents += l.ingredient!.unitCostCents * qtyInBase;
  }

  // usedIds: todos os ingredientes selecionados — o combobox de cada linha
  // recebe esse set SEM o próprio ingrediente da linha (calculado inline abaixo)
  const allUsedIds = new Set(lines.map((l) => l.ingredient?.id).filter(Boolean) as string[]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleBlocksChange = useCallback((blocks: Block[]) => {
    stepsRef.current = blocks;
  }, []);

  function handleSubmit() {
    if (!name.trim()) { toast.error("Nome da receita obrigatório."); return; }

    const fd = new FormData();
    if (recipeId) fd.set("id", recipeId);
    fd.set("name", name);
    fd.set("yieldQty", yieldQty);
    fd.set("notes", notes);
    fd.set("steps", JSON.stringify(stepsRef.current));
    fd.set(
      "ingredients",
      JSON.stringify(
        filledLines
          .map((l) => {
            const rawQty = parseFloat(l.quantity.replace(",", ".")) || 0;
            const base = l.ingredient!.baseUnit as BaseUnit;
            const { quantity } = toBaseUnit(rawQty, l.inputUnit, base);
            return { ingredientId: l.ingredient!.id, quantity };
          })
          .filter((l) => l.quantity > 0),
      ),
    );

    startSaving(async () => {
      const res = await saveRecipe(fd);
      if (res.ok) {
        toast.success(recipeId ? "Receita atualizada." : "Receita criada.");
        router.push("/admin/recipes");
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao salvar.");
      }
    });
  }

  return (
    <div className="space-y-8">

      {/* ── Informações básicas ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Informações
        </h2>

        <div className="space-y-2">
          <Label htmlFor="recipe-name">Nome da receita</Label>
          <Input
            id="recipe-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Cookie de Chocolate"
            required
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="recipe-yield">Rendimento (unidades)</Label>
            <Input
              id="recipe-yield"
              type="number"
              min="1"
              value={yieldQty}
              onChange={(e) => setYieldQty(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Custo estimado</Label>
            <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm tabular-nums">
              {costComplete
                ? `${formatBRL(Math.round(totalCostCents))} (${formatBRL(Math.round(totalCostCents / yieldNum))}/un)`
                : filledLines.length === 0
                  ? "—"
                  : "Sem preço p/ alguns ing."}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="recipe-notes">
            Observações <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="recipe-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: Guardar em recipiente fechado por até 7 dias."
          />
        </div>
      </section>

      <Separator />

      {/* ── Ingredientes ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Ingredientes
        </h2>

        <div className="space-y-2">
          {lines.map((line) => {
            const base = (line.ingredient?.baseUnit ?? "G") as BaseUnit;
            const unitOptions = recipeUnitsFor(base);
            const rawQty = parseFloat(line.quantity.replace(",", ".")) || 0;
            const { quantity: qtyBase } = toBaseUnit(rawQty, line.inputUnit, base);
            const lineCost = line.ingredient?.unitCostCents != null
              ? line.ingredient.unitCostCents * qtyBase
              : null;
            // usedIds para esta linha: exclui o ingrediente da própria linha
            const lineUsedIds = new Set(allUsedIds);
            if (line.ingredient?.id) lineUsedIds.delete(line.ingredient.id);

            return (
              <div key={line.key} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <div className="flex-1 min-w-0">
                  <IngredientCombobox
                    value={line.ingredient}
                    onChange={(ing) => setLineIngredient(line.key, ing)}
                    options={allIngredients}
                    onOptionCreated={handleIngredientCreated}
                    usedIds={lineUsedIds}
                  />
                </div>

                {/* Quantidade */}
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Qtd."
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  disabled={!line.ingredient}
                  className="w-20 text-right tabular-nums"
                />

                {/* Unidade */}
                <Select
                  value={line.inputUnit}
                  onValueChange={(v) => updateLine(line.key, { inputUnit: v as InputUnit })}
                  disabled={!line.ingredient}
                >
                  <SelectTrigger className="w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((u) => (
                      <SelectItem key={u} value={u} className="text-xs">
                        {UNIT_LABEL_SHORT[u]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Custo */}
                <span className="hidden sm:block w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {lineCost != null ? formatBRL(Math.round(lineCost)) : "—"}
                </span>

                {/* Remover */}
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>

        <Button type="button" variant="outline" className="w-full gap-2" onClick={addLine}>
          <Plus className="size-4" />
          Adicionar ingrediente
        </Button>
      </section>

      <Separator />

      {/* ── Passo a passo ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Passo a passo
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <BlockEditor
            initialContent={initialSteps}
            onChange={handleBlocksChange}
          />
        </div>
      </section>

      {/* ── Ações ────────────────────────────────────────────────────────── */}
      <div className="flex justify-end gap-3 pb-8">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/recipes")}
          disabled={saving}
        >
          Cancelar
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          <ChefHat className="size-4" />
          {saving ? "Salvando..." : recipeId ? "Salvar receita" : "Criar receita"}
        </Button>
      </div>
    </div>
  );
}
