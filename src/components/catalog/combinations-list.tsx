"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/shared/money-input";
import {
  allCombinations,
  combinationKey,
  combinationName,
  type KeyedOption,
} from "@/lib/variant-options";
import { cn } from "@/lib/utils";

const NO_RECIPE = "__none__";

export type CombinationEntry = {
  id: string | null;
  valueKeys: string[];
  priceCents: number;
  recipeId: string | null;
  active: boolean;
  needsReview?: boolean;
};

export function CombinationsList({
  options,
  entries,
  recipes,
  onToggle,
  onToggleAll,
  onUpdate,
}: {
  options: KeyedOption[];
  entries: CombinationEntry[];
  recipes: { id: string; name: string }[];
  onToggle: (valueKeys: string[], checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onUpdate: (key: string, patch: Partial<CombinationEntry>) => void;
}) {
  const filled = options.filter((o) => o.values.length > 0);
  if (filled.length !== options.length || options.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        Adicione pelo menos uma opção em cada tipo de variação para escolher o que você vende.
      </p>
    );
  }

  const byKey = new Map(entries.map((e) => [combinationKey(e.valueKeys), e]));
  const rows = allCombinations(options);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {options.length === 1 ? "Quais você vende?" : "Quais combinações você vende?"}{" "}
            <span className="font-normal text-muted-foreground">
              {entries.length} de {rows.length}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Deixe o preço em R$ 0,00 para usar o preço padrão. Pausadas não aparecem na venda.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onToggleAll(true)}>
            Marcar todas
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onToggleAll(false)}>
            Desmarcar todas
          </Button>
        </div>
      </div>

      <ul className="divide-y rounded-lg border bg-card">
        {rows.map((valueKeys) => {
          const key = combinationKey(valueKeys);
          const entry = byKey.get(key);
          const name = combinationName(options, valueKeys);
          return (
            <li key={key} className={cn("space-y-3 p-3", entry && !entry.active && "opacity-60")}>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="size-4 accent-[hsl(var(--primary))]"
                  checked={!!entry}
                  onChange={(e) => onToggle(valueKeys, e.target.checked)}
                />
                <span className="flex-1 text-sm font-medium">{name}</span>
                {entry?.needsReview && (
                  <Badge variant="outline" className="border-warning text-warning-text">
                    Confira
                  </Badge>
                )}
              </label>

              {entry && (
                <div className="flex flex-wrap items-center gap-3 pl-7">
                  <MoneyInput
                    valueCents={entry.priceCents}
                    onChangeCents={(cents) => onUpdate(key, { priceCents: cents })}
                    className="h-9 w-32"
                    aria-label={`Preço de ${name}`}
                  />
                  {recipes.length > 0 && (
                    <Select
                      value={entry.recipeId ?? NO_RECIPE}
                      onValueChange={(value) => onUpdate(key, { recipeId: value === NO_RECIPE ? null : value })}
                    >
                      <SelectTrigger className="h-9 min-w-40 flex-1">
                        <SelectValue placeholder="Ficha técnica" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_RECIPE}>Sem ficha técnica</SelectItem>
                        {recipes.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={entry.active}
                      onCheckedChange={(checked) => onUpdate(key, { active: checked })}
                    />
                    <span className="w-16">{entry.active ? "Disponível" : "Pausada"}</span>
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
