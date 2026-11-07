"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReceiveSheet, toReceiveTarget, type ReceiveResult } from "@/components/sales/receive-sheet";
import { unpayInstallments } from "@/server/actions/sales";
import type { ForecastPreset } from "@/lib/business-days";
import { formatBRL } from "@/lib/money";
import type { SaleRow } from "@/lib/partial-payment";

export function MarkAsPaidButton({
  next,
  sale,
}: {
  next: { id: string; number: number; amountCents: number; dueDate: Date | null };
  sale: {
    customerName: string | null;
    soldAt: Date;
    forecastPreset: ForecastPreset | null;
    installmentCount: number;
    rows: SaleRow[];
  };
}) {
  const [open, setOpen] = useState(false);
  const parceled = sale.installmentCount > 1;
  const target = toReceiveTarget(next, sale);

  function handleReceived(result: ReceiveResult) {
    setOpen(false);
    const message = result.partial
      ? `${formatBRL(result.totalCents)} recebido. O restante continua em aberto.`
      : parceled
        ? `Parcela ${next.number}/${sale.installmentCount} recebida.`
        : "Venda marcada como paga.";
    toast.success(message, {
      action: {
        label: "Desfazer",
        onClick: () => {
          void unpayInstallments(result.paidInstallmentIds).then((r) => {
            if (r.ok) {
              toast.success(
                result.partial
                  ? "Recebimento desfeito."
                  : parceled
                    ? "Parcela voltou para em aberto."
                    : "Venda voltou para pendente.",
              );
            } else {
              toast.error(r.error ?? "Erro ao desfazer.");
            }
          });
        },
      },
    });
  }

  const title = parceled ? `Receber parcela ${next.number}/${sale.installmentCount}` : "Receber venda";
  const subtitle = sale.customerName
    ? `${sale.customerName} · venda de ${target.saleLabel}`
    : `Venda de ${target.saleLabel}`;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-11 gap-1.5 text-success border-success/40 hover:bg-success/10 hover:text-success"
        onClick={() => setOpen(true)}
      >
        <CheckCircle className="size-3.5" />
        {parceled ? `Receber ${formatBRL(next.amountCents)}` : "Marcar como pago"}
      </Button>
      <ReceiveSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        subtitle={subtitle}
        targets={[target]}
        onReceived={handleReceived}
      />
    </>
  );
}
