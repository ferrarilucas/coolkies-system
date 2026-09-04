"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { endOfMonth, format } from "date-fns";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MoneyInput } from "@/components/shared/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CustomerSituation } from "@/lib/customer-balance";

export type CustomersFilterValues = {
  q: string;
  situation: CustomerSituation;
  sector: string;
  minDue: number;
  forecastTo: string;
};

const SITUATIONS: { value: CustomerSituation; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Com pendência" },
  { value: "overdue", label: "Em atraso" },
  { value: "clear", label: "Em dia" },
];

const ALL_SECTORS = "__all__";

export function CustomersFilters({
  values,
  sectors,
}: {
  values: CustomersFilterValues;
  sectors: string[];
}) {
  const router = useRouter();
  const [q, setQ] = useState(values.q);
  const [minDue, setMinDue] = useState(values.minDue);

  const today = format(new Date(), "yyyy-MM-dd");
  const forecastPresets = [
    { label: "Até hoje", value: today },
    { label: "Até o fim do mês", value: format(endOfMonth(new Date()), "yyyy-MM-dd") },
  ];

  const activeCount = [
    values.sector,
    values.minDue > 0 ? "1" : "",
    values.forecastTo,
  ].filter(Boolean).length;
  const [open, setOpen] = useState(activeCount > 0);

  function navigate(next: Partial<CustomersFilterValues>) {
    const v = { ...values, q: q.trim(), minDue, ...next };
    const params = new URLSearchParams();
    if (v.situation !== "all") params.set("situation", v.situation);
    if (v.q) params.set("q", v.q);
    if (v.sector) params.set("sector", v.sector);
    if (v.minDue > 0) params.set("mindue", String(v.minDue));
    if (v.forecastTo) params.set("pto", v.forecastTo);
    const qs = params.toString();
    router.push(`/customers${qs ? `?${qs}` : ""}`);
  }

  function clearAll() {
    setQ("");
    setMinDue(0);
    navigate({ q: "", sector: "", minDue: 0, forecastTo: "" });
  }

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
          placeholder="Buscar por nome, setor, e-mail ou telefone…"
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

      <div className="flex flex-wrap gap-2">
        {SITUATIONS.map((s) => (
          <Button
            key={s.value}
            type="button"
            size="sm"
            variant={values.situation === s.value ? "default" : "outline"}
            onClick={() => navigate({ situation: s.value })}
          >
            {s.label}
          </Button>
        ))}
      </div>

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
        {(activeCount > 0 || values.q || values.situation !== "all") && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Limpar filtros
          </Button>
        )}
      </div>

      {open && (
        <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="filter-pto">Previsto até</Label>
            <div className="flex flex-wrap gap-2">
              {forecastPresets.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  size="sm"
                  variant={values.forecastTo === p.value ? "default" : "outline"}
                  onClick={() =>
                    navigate({ forecastTo: values.forecastTo === p.value ? "" : p.value })
                  }
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Input
              id="filter-pto"
              type="date"
              value={values.forecastTo}
              onChange={(e) => navigate({ forecastTo: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Considera só as vendas com previsão até essa data — o total a receber e o
              recebimento seguem esse recorte. Vendas sem previsão entram sempre.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Setor</Label>
            <Select
              value={values.sector || ALL_SECTORS}
              onValueChange={(v) => navigate({ sector: v === ALL_SECTORS ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos os setores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SECTORS}>Todos os setores</SelectItem>
                {sectors.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filter-mindue">Deve a partir de</Label>
            <MoneyInput
              id="filter-mindue"
              valueCents={minDue}
              onChangeCents={setMinDue}
              className="w-full"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => navigate({})}
            >
              Aplicar valor
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
