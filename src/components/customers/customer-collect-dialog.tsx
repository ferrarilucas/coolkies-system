"use client";

import { useMemo, useState, type ReactNode } from "react";
import { endOfDay, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpenInstallments } from "@/components/customers/installment-picker";
import { ReceiveSheet, toReceiveTarget, type ReceiveResult } from "@/components/sales/receive-sheet";
import { formatBRL } from "@/lib/money";
import { parseForecastCutoff } from "@/lib/customer-balance";

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
  const picker = useOpenInstallments(customerId, forecastTo, open);
  const { installments, selected, toggle, toggleAll, allSelected, loadFailed, retryLoad } = picker;

  const targets = useMemo(
    () =>
      (installments ?? []).map((inst) =>
        toReceiveTarget(inst, {
          soldAt: inst.sale.soldAt,
          forecastPreset: inst.sale.forecastPreset,
          installmentCount: inst.sale.installmentCount,
          rows: inst.sale.installments,
        }),
      ),
    [installments],
  );
  const dueIds = useMemo(() => {
    const today = endOfDay(new Date());
    return (installments ?? []).filter((i) => !i.dueDate || i.dueDate <= today).map((i) => i.id);
  }, [installments]);

  const cutoff = parseForecastCutoff(forecastTo);
  const cutoffLabel = cutoff ? format(cutoff, "dd/MM/yyyy", { locale: ptBR }) : null;

  function handleReceived(result: ReceiveResult) {
    setOpen(false);
    toast.success(
      result.partial
        ? `${formatBRL(result.totalCents)} recebido. O restante continua em aberto.`
        : `${result.count} ${result.count === 1 ? "parcela recebida" : "parcelas recebidas"} — ${formatBRL(result.totalCents)}.`,
    );
  }

  return (
    <>
      <Button size={triggerSize} className={triggerClassName} onClick={() => setOpen(true)}>
        <HandCoins />
        {triggerLabel ?? "Receber"}
      </Button>

      <ReceiveSheet
        open={open}
        onOpenChange={setOpen}
        title={`Receber de ${[customerName, customerSector].filter(Boolean).join(" · ")}`}
        subtitle={`${pendingCount} ${pendingCount === 1 ? "venda em aberto" : "vendas em aberto"}${
          cutoffLabel ? ` com previsão até ${cutoffLabel}` : ""
        }, totalizando ${formatBRL(pendingCents)}. Toque numa parcela para incluir ou tirar.`}
        targets={targets}
        selection={{ selected, toggle, dueIds, toggleAll, allSelected }}
        loading={installments === null && !loadFailed}
        loadFailed={loadFailed}
        onRetry={retryLoad}
        onReceived={handleReceived}
      />
    </>
  );
}
