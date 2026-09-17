"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { format, subDays, startOfMonth, startOfYear, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { SlidersHorizontal, X, Loader2, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const ALL = "__all__";

type Option = { id: string; name: string };
type ItemOption = Option & { variants: Option[] };

export type DashboardFilterOptions = {
  products: ItemOption[];
  customers: Option[];
  suppliers: Option[];
};

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

const PRESETS: { label: string; days?: number; kind?: "month" | "year" }[] = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "Mês", kind: "month" },
  { label: "Ano", kind: "year" },
];

export function DashboardFilters({
  options,
  current,
}: {
  options: DashboardFilterOptions;
  current: {
    from: string;
    to: string;
    status: string;
    itemId?: string;
    variantId?: string;
    customerId?: string;
    supplierId?: string;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const variants = useMemo(
    () =>
      options.products.find((p) => p.id === current.itemId)?.variants ?? [],
    [options.products, current.itemId],
  );

  function apply(next: Partial<typeof current>) {
    const params = new URLSearchParams(searchParams.toString());
    const merged = { ...current, ...next };
    // sabor depende do produto
    if (next.itemId !== undefined) merged.variantId = undefined;

    const setOrDel = (k: string, v?: string) => {
      if (v && v !== ALL) params.set(k, v);
      else params.delete(k);
    };
    params.set("from", merged.from);
    params.set("to", merged.to);
    setOrDel("status", merged.status === "ALL" ? undefined : merged.status);
    setOrDel("itemId", merged.itemId);
    setOrDel("variantId", merged.variantId);
    setOrDel("customerId", merged.customerId);
    setOrDel("supplierId", merged.supplierId);

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    const to = new Date();
    let from: Date;
    if (p.kind === "month") from = startOfMonth(to);
    else if (p.kind === "year") from = startOfYear(to);
    else from = subDays(to, (p.days ?? 30) - 1);
    apply({ from: fmt(from), to: fmt(to) });
  }

  function clearAll() {
    const to = new Date();
    const from = subDays(to, 29);
    startTransition(() => {
      router.replace(`${pathname}?from=${fmt(from)}&to=${fmt(to)}`, {
        scroll: false,
      });
    });
  }

  const activeCount = [
    current.status && current.status !== "ALL",
    current.itemId,
    current.variantId,
    current.customerId,
    current.supplierId,
  ].filter(Boolean).length;

  const rangeLabel = useMemo(() => {
    try {
      const f = parseISO(current.from);
      const t = parseISO(current.to);
      const sameYear = f.getFullYear() === t.getFullYear();
      const fromFmt = format(f, sameYear ? "d MMM" : "d MMM yyyy", { locale: ptBR });
      const toFmt = format(t, "d MMM yyyy", { locale: ptBR });
      return `${fromFmt} – ${toFmt}`;
    } catch {
      return "";
    }
  }, [current.from, current.to]);

  return (
    <div className="mb-4 rounded-lg border bg-card">
      {/* Linha de presets + toggle */}
      <div className="flex flex-wrap items-center gap-2 p-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isPending && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
          {/* Período ativo — sempre visível */}
          {rangeLabel && (
            <span className="flex items-center gap-1.5 rounded-md border bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5 shrink-0" />
              {rangeLabel}
            </span>
          )}
          <Button
            variant={activeCount > 0 ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setOpen((o) => !o)}
          >
            <SlidersHorizontal className="size-4" />
            Filtros
            {activeCount > 0 && (
              <span className="ml-1 rounded-full bg-background/20 px-1.5 text-xs">
                {activeCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Painel de filtros */}
      {open && (
        <div className="border-t p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Período */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">De</Label>
              <input
                type="date"
                value={current.from}
                max={current.to}
                onChange={(e) => apply({ from: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 md:text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Até</Label>
              <input
                type="date"
                value={current.to}
                min={current.from}
                onChange={(e) => apply({ to: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 md:text-sm"
              />
            </div>

            {/* Status */}
            <FilterSelect
              label="Status"
              value={current.status || ALL}
              onChange={(v) => apply({ status: v })}
              placeholder="Todos"
              items={[
                { id: "PAID", name: "Pagas" },
                { id: "PENDING", name: "Pendentes" },
              ]}
            />

            {/* Produto */}
            <FilterSelect
              label="Produto"
              value={current.itemId || ALL}
              onChange={(v) => apply({ itemId: v === ALL ? undefined : v })}
              placeholder="Todos"
              items={options.products}
            />

            {/* Sabor */}
            <FilterSelect
              label="Sabor"
              value={current.variantId || ALL}
              onChange={(v) => apply({ variantId: v === ALL ? undefined : v })}
              placeholder={current.itemId ? "Todos" : "Selecione produto"}
              items={variants}
              disabled={!current.itemId || variants.length === 0}
            />

            {/* Cliente */}
            <FilterSelect
              label="Cliente"
              value={current.customerId || ALL}
              onChange={(v) => apply({ customerId: v === ALL ? undefined : v })}
              placeholder="Todos"
              items={options.customers}
            />

            {/* Fornecedor */}
            <FilterSelect
              label="Fornecedor"
              value={current.supplierId || ALL}
              onChange={(v) => apply({ supplierId: v === ALL ? undefined : v })}
              placeholder="Todos"
              items={options.suppliers}
            />
          </div>

          {activeCount > 0 && (
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <X className="size-4" />
                Limpar filtros
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  placeholder,
  items,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  items: Option[];
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-10">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{placeholder}</SelectItem>
          {items.map((it) => (
            <SelectItem key={it.id} value={it.id}>
              {it.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
