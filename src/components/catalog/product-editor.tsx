"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/shared/money-input";
import { saveItem } from "@/server/actions/catalog";
import type { ItemForEdit } from "@/server/queries/catalog";
import { cn } from "@/lib/utils";

const NO_RECIPE = "__none__";

type VariantLine = {
  key: string;
  id: string | null;
  name: string;
  priceCents: number;
  recipeId: string | null;
  active: boolean;
};

function toLine(variant: ItemForEdit["variants"][number]): VariantLine {
  return {
    key: variant.id,
    id: variant.id,
    name: variant.name,
    priceCents: variant.priceCents ?? 0,
    recipeId: variant.recipeId,
    active: variant.active,
  };
}

function blankLine(): VariantLine {
  return {
    key: crypto.randomUUID(),
    id: null,
    name: "",
    priceCents: 0,
    recipeId: null,
    active: true,
  };
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
  const [genericPriceCents, setGenericPriceCents] = useState(
    product?.genericPriceCents ?? 0,
  );
  const [variants, setVariants] = useState<VariantLine[]>(
    product?.variants.map(toLine) ?? [],
  );
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [saving, startSave] = useTransition();

  const hasVariants = variants.length > 0;

  function updateVariant(key: string, patch: Partial<VariantLine>) {
    setVariants((prev) =>
      prev.map((v) => (v.key === key ? { ...v, ...patch } : v)),
    );
  }

  function removeVariant(line: VariantLine) {
    setVariants((prev) => prev.filter((v) => v.key !== line.key));
    if (line.id) setRemovedIds((prev) => [...prev, line.id!]);
  }

  function handleSubmit() {
    startSave(async () => {
      const res = await saveItem(product?.id ?? null, {
        name,
        genericPriceCents: genericPriceCents > 0 ? genericPriceCents : null,
        variants: variants.map((v) => ({
          id: v.id,
          name: v.name,
          priceCents: v.priceCents > 0 ? v.priceCents : null,
          recipeId: v.recipeId,
          active: v.active,
        })),
        removedVariantIds: removedIds,
      });

      if (!res.ok) {
        toast.error(res.error ?? "Erro ao salvar.");
        return;
      }

      const deactivated = res.data?.deactivated ?? [];
      if (deactivated.length > 0) {
        toast.success(
          `Produto salvo. ${deactivated.join(", ")} ${deactivated.length === 1 ? "foi desativado" : "foram desativados"} por já ter histórico.`,
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
              placeholder="Ex.: Cookie"
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
                ? "Usado nos sabores que não tiverem preço próprio."
                : "Preço cobrado por unidade deste produto."}
            </p>
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Sabores
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Opcional. Cada sabor pode ter seu próprio preço.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVariants((prev) => [...prev, blankLine()])}
          >
            <Plus />
            Adicionar sabor
          </Button>
        </div>

        {!hasVariants ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
            <Palette className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum sabor — o produto será vendido pelo preço de venda acima.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {variants.map((variant) => (
              <div
                key={variant.key}
                className={cn(
                  "space-y-3 rounded-lg border bg-card p-3",
                  !variant.active && "opacity-60",
                )}
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                  <Input
                    value={variant.name}
                    onChange={(e) => updateVariant(variant.key, { name: e.target.value })}
                    placeholder="Nome do sabor"
                  />
                  <MoneyInput
                    valueCents={variant.priceCents}
                    onChangeCents={(cents) => updateVariant(variant.key, { priceCents: cents })}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {recipes.length > 0 && (
                    <Select
                      value={variant.recipeId ?? NO_RECIPE}
                      onValueChange={(value) =>
                        updateVariant(variant.key, {
                          recipeId: value === NO_RECIPE ? null : value,
                        })
                      }
                    >
                      <SelectTrigger className="h-9 flex-1 min-w-40">
                        <SelectValue placeholder="Recheio…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_RECIPE}>Sem recheio</SelectItem>
                        {recipes.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={variant.active}
                      onCheckedChange={(checked) =>
                        updateVariant(variant.key, { active: checked })
                      }
                    />
                    Ativo
                  </label>

                  <button
                    type="button"
                    onClick={() => removeVariant(variant)}
                    className="ml-auto flex size-9 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
                    aria-label={`Remover ${variant.name || "sabor"}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
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
