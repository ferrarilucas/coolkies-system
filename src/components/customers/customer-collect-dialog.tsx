"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { endOfDay, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Check, HandCoins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { getOpenInstallmentsByCustomer } from "@/server/queries/customers";
import { payInstallments } from "@/server/actions/sales";
import { formatBRL } from "@/lib/money";
import { parseForecastCutoff } from "@/lib/customer-balance";
import { cn } from "@/lib/utils";

type OpenInstallment = Awaited<ReturnType<typeof getOpenInstallmentsByCustomer>>[number];

export function CustomerCollectDialog({
  customerId,
  customerName,
  customerSector,
  pendingCents,
  pendingCount,
  forecastTo,
  triggerClassName,
  triggerSize = "sm",
  triggerLabel,
}: {
  customerId: string;
  customerName: string;
  customerSector?: string | null;
  pendingCents: number;
  pendingCount: number;
  forecastTo?: string;
  triggerClassName?: string;
  triggerSize?: "sm" | "lg";
  triggerLabel?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [installments, setInstallments] = useState<OpenInstallment[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, startSave] = useTransition();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setInstallments(null);
    getOpenInstallmentsByCustomer(customerId, forecastTo).then((rows) => {
      if (!active) return;
      const today = endOfDay(new Date());
      setInstallments(rows);
      setSelected(new Set(rows.filter((r) => !r.dueDate || r.dueDate <= today).map((r) => r.id)));
    });
    return () => {
      active = false;
    };
  }, [open, customerId, forecastTo]);

  const cutoff = parseForecastCutoff(forecastTo);
  const cutoffLabel = cutoff ? format(cutoff, "dd/MM/yyyy", { locale: ptBR }) : null;
  const selectedInstallments = (installments ?? []).filter((i) => selected.has(i.id));
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

  function handleConfirm() {
    startSave(async () => {
      const res = await payInstallments([...selected]);
      if (res.ok && res.data) {
        toast.success(
          `${res.data.count} ${res.data.count === 1 ? "parcela recebida" : "parcelas recebidas"} — ${formatBRL(res.data.totalCents)}.`,
        );
        setOpen(false);
      } else {
        toast.error(res.error ?? "Erro ao registrar recebimento.");
      }
    });
  }

  return (
    <>
      <Button size={triggerSize} className={triggerClassName} onClick={() => setOpen(true)}>
        <HandCoins />
        {triggerLabel ?? "Receber"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Receber de {[customerName, customerSector].filter(Boolean).join(" · ")}
            </DialogTitle>
            <DialogDescription>
              {pendingCount} {pendingCount === 1 ? "venda em aberto" : "vendas em aberto"}
              {cutoffLabel ? ` com previsão até ${cutoffLabel}` : ""}, totalizando{" "}
              {formatBRL(pendingCents)}. Selecione o que foi pago.
            </DialogDescription>
          </DialogHeader>

          {installments === null ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : installments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma parcela em aberto.
            </p>
          ) : (
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
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={saving || selected.size === 0}>
              {saving ? "Registrando…" : `Receber ${formatBRL(selectedCents)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
