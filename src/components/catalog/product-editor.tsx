"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MoneyInput } from "@/components/shared/money-input";
import { OptionsEditor } from "@/components/catalog/options-editor";
import { CombinationsList, type CombinationEntry } from "@/components/catalog/combinations-list";
import { saveItem } from "@/server/actions/catalog";
import type { ItemForEdit } from "@/server/queries/catalog";
import {
  allCombinations,
  combinationKey,
  rebaseCombinations,
  type KeyedOption,
} from "@/lib/variant-options";

function initialOptions(product: ItemForEdit | null): KeyedOption[] {
  return (product?.options ?? []).map((o) => ({
    key: o.id,
    id: o.id,
    name: o.name,
    values: o.values.map((v) => ({ key: v.id, id: v.id, name: v.name })),
  }));
}

function initialEntries(product: ItemForEdit | null, options: KeyedOption[]): CombinationEntry[] {
  if (!product || options.length === 0) return [];
  return product.variants.flatMap((variant) => {
    const ids = new Set(variant.valueIds);
    const valueKeys = options.map((o) => o.values.find((v) => ids.has(v.key))?.key);
    if (valueKeys.some((k) => !k)) return [];
    return [{
      id: variant.id,
      valueKeys: valueKeys as string[],
      priceCents: variant.priceCents ?? 0,
      recipeId: variant.recipeId,
      active: variant.active,
    }];
  });
}

export function ProductEditor({
  product,
  recipes,
}: {
  product: ItemForEdit | null;
  recipes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(product?.name ?? "");
  const [genericPriceCents, setGenericPriceCents] = useState(product?.genericPriceCents ?? 0);
  const [options, setOptions] = useState<KeyedOption[]>(() => initialOptions(product));
  const [entries, setEntries] = useState<CombinationEntry[]>(() => initialEntries(product, options));
  const [originals] = useState(() => new Map(entries.map((e) => [combinationKey(e.valueKeys), e])));
  const [saving, startSave] = useTransition();

  const hasVariants = options.length > 0;

  function changeOptions(next: KeyedOption[]) {
    setEntries((prev) => rebaseCombinations(options, next, prev));
    setOptions(next);
  }

  function blankEntry(valueKeys: string[]): CombinationEntry {
    return originals.get(combinationKey(valueKeys)) ?? {
      id: null,
      valueKeys,
      priceCents: 0,
      recipeId: null,
      active: true,
    };
  }

  function toggle(valueKeys: string[], checked: boolean) {
    const key = combinationKey(valueKeys);
    setEntries((prev) => {
      const rest = prev.filter((e) => combinationKey(e.valueKeys) !== key);
      return checked ? [...rest, blankEntry(valueKeys)] : rest;
    });
  }

  function toggleAll(checked: boolean) {
    if (!checked) {
      setEntries([]);
      return;
    }
    setEntries((prev) => {
      const byKey = new Map(prev.map((e) => [combinationKey(e.valueKeys), e]));
      return allCombinations(options).map((keys) => byKey.get(combinationKey(keys)) ?? blankEntry(keys));
    });
  }

  function update(key: string, patch: Partial<CombinationEntry>) {
    setEntries((prev) => prev.map((e) => (combinationKey(e.valueKeys) === key ? { ...e, ...patch } : e)));
  }

  function handleSubmit() {
    const keptIds = new Set(entries.map((e) => e.id).filter(Boolean));
    const removedVariantIds = [...originals.values()]
      .map((e) => e.id!)
      .filter((id) => !keptIds.has(id));

    startSave(async () => {
      const res = await saveItem(product?.id ?? null, {
        name,
        genericPriceCents: genericPriceCents > 0 ? genericPriceCents : null,
        options: options.map(({ id, name: optionName, values }) => ({ id, name: optionName, values })),
        combinations: entries.map((e) => ({
          id: e.id,
          valueKeys: e.valueKeys,
          priceCents: e.priceCents > 0 ? e.priceCents : null,
          recipeId: e.recipeId,
          active: e.active,
        })),
        removedVariantIds,
      });

      if (!res.ok) {
        toast.error(res.error ?? "Erro ao salvar.");
        return;
      }

      const deactivated = res.data?.deactivated ?? [];
      if (deactivated.length > 0) {
        toast.success(
          `Produto salvo. ${deactivated.join(", ")} ${deactivated.length === 1 ? "foi desativada" : "foram desativadas"} por já ter histórico.`,
        );
      } else {
        toast.success(product ? "Produto atualizado." : "Produto criado.");
      }

      router.push("/admin/catalog");
      router.refresh();
    });
  }

  return (
    <div className="space-y-8 pb-24">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Produto
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="product-name">Nome *</Label>
            <Input
              id="product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Camiseta"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="generic-price">
              {hasVariants ? "Preço padrão" : "Preço de venda *"}
            </Label>
            <MoneyInput
              id="generic-price"
              valueCents={genericPriceCents}
              onChangeCents={setGenericPriceCents}
            />
            <p className="text-xs text-muted-foreground">
              {hasVariants
                ? "Usado nas combinações que não tiverem preço próprio."
                : "Preço cobrado por unidade deste produto."}
            </p>
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Variações
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Opcional. Crie até 3 eixos, como Tamanho e Cor, e marque as combinações que você vende.
          </p>
        </div>

        <OptionsEditor options={options} onChange={changeOptions} />

        {hasVariants ? (
          <CombinationsList
            options={options}
            entries={entries}
            recipes={recipes}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onUpdate={update}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Sem variações, o produto é vendido pelo preço de venda acima.
          </p>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl gap-2 md:justify-end">
          <Button
            type="button"
            variant="outline"
            className="flex-1 md:flex-none"
            onClick={() => router.push("/admin/catalog")}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="flex-1 md:flex-none"
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
          >
            {saving ? "Salvando…" : "Salvar produto"}
          </Button>
        </div>
      </div>
    </div>
  );
}
