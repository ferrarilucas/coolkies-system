"use client";

import { useEffect, useMemo, useState } from "react";
import { endOfDay, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getOpenInstallmentsByCustomer } from "@/server/queries/customers";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

export type OpenInstallment = Awaited<ReturnType<typeof getOpenInstallmentsByCustomer>>[number];

export type OpenInstallmentsState = {
  installments: OpenInstallment[] | null;
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: () => void;
  allSelected: boolean;
  selectedCents: number;
  selectedIds: string[];
  loadFailed: boolean;
  retryLoad: () => void;
};

export function useOpenInstallments(
  customerId: string,
  forecastTo: string | undefined,
  open: boolean,
): OpenInstallmentsState {
  const [installments, setInstallments] = useState<OpenInstallment[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setInstallments(null);
    setLoadFailed(false);
    getOpenInstallmentsByCustomer(customerId, forecastTo)
      .then((rows) => {
        if (!active) return;
        const today = endOfDay(new Date());
        setInstallments(rows);
        setSelected(new Set(rows.filter((r) => !r.dueDate || r.dueDate <= today).map((r) => r.id)));
      })
      .catch((error) => {
        if (!active) return;
        console.error("[customers] falha ao carregar parcelas em aberto", error);
        setSelected(new Set());
        setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [open, customerId, forecastTo, attempt]);

  const selectedInstallments = useMemo(
    () => (installments ?? []).filter((i) => selected.has(i.id)),
    [installments, selected],
  );
  const selectedIds = useMemo(() => selectedInstallments.map((i) => i.id).sort(), [selectedInstallments]);
  const selectedCents = selectedInstallments.reduce((sum, i) => sum + i.amountCents, 0);
  const allSelected =
    installments !== null && installments.length > 0 && selected.size === installments.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set((installments ?? []).map((i) => i.id)));
  }

  function retryLoad() {
    setAttempt((n) => n + 1);
  }

  return {
    installments,
    selected,
    toggle,
    toggleAll,
    allSelected,
    selectedCents,
    selectedIds,
    loadFailed,
    retryLoad,
  };
}

export function InstallmentPicker({
  installments,
  selected,
  toggle,
  toggleAll,
  allSelected,
  loadFailed,
  retryLoad,
}: OpenInstallmentsState) {
  if (loadFailed) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-destructive">
        <span>Não foi possível carregar as parcelas.</span>
        <Button type="button" variant="outline" size="sm" onClick={retryLoad}>
          <RotateCw />
          Tentar de novo
        </Button>
      </div>
    );
  }

  if (installments === null) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (installments.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma parcela em aberto.</p>;
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {selected.size} de {installments.length} selecionada{installments.length === 1 ? "" : "s"}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
          {allSelected ? "Limpar seleção" : "Selecionar tudo"}
        </Button>
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto">
        {installments.map((inst) => {
          const isSelected = selected.has(inst.id);
          const overdue = inst.dueDate !== null && inst.dueDate < new Date();
          return (
            <button
              key={inst.id}
              type="button"
              onClick={() => toggle(inst.id)}
              aria-pressed={isSelected}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                isSelected ? "border-primary bg-primary/5" : "hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded border",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {isSelected && <Check className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {formatBRL(inst.amountCents)}
                  {inst.sale.installmentCount > 1 && (
                    <span className="font-normal text-muted-foreground">
                      {" "}· parcela {inst.number}/{inst.sale.installmentCount}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Venda {format(inst.sale.soldAt, "dd/MM/yyyy", { locale: ptBR })}
                  {inst.dueDate && ` · vence ${format(inst.dueDate, "dd/MM", { locale: ptBR })}`}
                </span>
              </span>
              {overdue && (
                <Badge variant="destructive" className="shrink-0">
                  Atrasada
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
