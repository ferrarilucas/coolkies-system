"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format } from "date-fns";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { CustomerFilterCombobox } from "@/components/sales/customer-filter-combobox";
import type { CustomerSummary } from "@/server/queries/customers";

export type SalesFilterValues = {
  q: string;
  tab: string;
  customerId: string;
  from: string;
  to: string;
  pfrom: string;
  pto: string;
  overdue: boolean;
};

export function SalesFilters({
  selectedCustomer,
  values,
}: {
  selectedCustomer: CustomerSummary | null;
  values: SalesFilterValues;
}) {
  const router = useRouter();
  const [q, setQ] = useState(values.q);

  const activeCount = [
    values.customerId,
    values.from,
    values.to,
    values.pfrom || values.pto,
    values.overdue ? "1" : "",
  ].filter(Boolean).length;

  const [open, setOpen] = useState(activeCount > 0);

  function navigate(next: Partial<SalesFilterValues>) {
    const v = { ...values, q: q.trim(), ...next };
    const params = new URLSearchParams();
    if (v.tab !== "all") params.set("tab", v.tab);
    if (v.q) params.set("q", v.q);
    if (v.customerId) params.set("customer", v.customerId);
    if (v.from) params.set("from", v.from);
    if (v.to) params.set("to", v.to);
    if (v.pfrom) params.set("pfrom", v.pfrom);
    if (v.pto) params.set("pto", v.pto);
    if (v.overdue) params.set("overdue", "1");
    const qs = params.toString();
    router.push(`/sales${qs ? `?${qs}` : ""}`);
  }

  function clearAll() {
    setQ("");
    navigate({ q: "", customerId: "", from: "", to: "", pfrom: "", pto: "", overdue: false });
  }

  const today = format(new Date(), "yyyy-MM-dd");
  const forecastPresets = [
    { label: "Hoje", pfrom: today, pto: today },
    {
      label: "Amanhã",
      pfrom: format(addDays(new Date(), 1), "yyyy-MM-dd"),
      pto: format(addDays(new Date(), 1), "yyyy-MM-dd"),
    },
    {
      label: "Próx. 7 dias",
      pfrom: today,
      pto: format(addDays(new Date(), 7), "yyyy-MM-dd"),
    },
  ];

  return (
    <div className="mb-4 space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({});
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por cliente, produto ou observação…"
          className="pl-9 pr-9"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              navigate({ q: "" });
            }}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        )}
      </form>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          <SlidersHorizontal />
          Filtros
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {activeCount}
            </Badge>
          )}
        </Button>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Limpar filtros
          </Button>
        )}
      </div>

      {open && (
        <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Cliente</Label>
            <CustomerFilterCombobox
              selected={selectedCustomer}
              onSelect={(c) => navigate({ customerId: c?.id ?? "" })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-from">Venda de</Label>
            <Input
              id="filter-from"
              type="date"
              value={values.from}
              onChange={(e) => navigate({ from: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-to">Venda até</Label>
            <Input
              id="filter-to"
              type="date"
              value={values.to}
              onChange={(e) => navigate({ to: e.target.value })}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Previsão de pagamento</Label>
            <div className="flex flex-wrap gap-2">
              {forecastPresets.map((p) => {
                const active = values.pfrom === p.pfrom && values.pto === p.pto;
                return (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() =>
                      navigate(
                        active
                          ? { pfrom: "", pto: "" }
                          : { pfrom: p.pfrom, pto: p.pto },
                      )
                    }
                  >
                    {p.label}
                  </Button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5">
                <Label htmlFor="filter-pfrom" className="text-xs text-muted-foreground">
                  Previsto de
                </Label>
                <Input
                  id="filter-pfrom"
                  type="date"
                  value={values.pfrom}
                  onChange={(e) => navigate({ pfrom: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="filter-pto" className="text-xs text-muted-foreground">
                  Previsto até
                </Label>
                <Input
                  id="filter-pto"
                  type="date"
                  value={values.pto}
                  onChange={(e) => navigate({ pto: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch
              id="filter-overdue"
              checked={values.overdue}
              onCheckedChange={(checked) => navigate({ overdue: checked })}
            />
            <Label htmlFor="filter-overdue">Só atrasadas (previsão vencida)</Label>
          </div>
        </div>
      )}
    </div>
  );
}
