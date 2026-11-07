"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReceiveSheet, toReceiveTarget, type ReceiveResult } from "@/components/sales/receive-sheet";
import { unpayInstallments } from "@/server/actions/sales";
import type { ForecastPreset } from "@/lib/business-days";
import { formatBRL } from "@/lib/money";
import type { SaleRow } from "@/lib/partial-payment";

export function SaleInstallments({
  installments,
  sale,
}: {
  installments: SaleRow[];
  sale: { customerName: string | null; soldAt: Date; forecastPreset: ForecastPreset | null; installmentCount: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const total = installments.reduce((max, i) => Math.max(max, i.number), installments.length);
  const receiving = installments.find((i) => i.id === receivingId) ?? null;
  const target = receiving
    ? toReceiveTarget(receiving, {
        soldAt: sale.soldAt,
        forecastPreset: sale.forecastPreset,
        installmentCount: sale.installmentCount,
        rows: installments,
      })
    : null;

  function handleReceived(result: ReceiveResult) {
    const number = receiving?.number;
    setSheetOpen(false);
    toast.success(
      result.partial
        ? `${formatBRL(result.totalCents)} recebido. O restante continua em aberto.`
        : `Parcela ${number} recebida.`,
    );
    router.refresh();
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(res.error ?? "Erro ao atualizar.");
      }
    });
  }

  return (
    <section className="mb-8 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Parcelas</h2>
      <ul className="divide-y rounded-lg border">
        {installments.map((inst) => {
          const overdue = !inst.paidAt && inst.dueDate !== null && inst.dueDate < new Date();
          return (
            <li key={inst.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium tabular-nums">
                  {inst.number}/{total} · {formatBRL(inst.amountCents)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {inst.paidAt
                    ? `Paga em ${format(inst.paidAt, "dd/MM/yyyy", { locale: ptBR })}`
                    : inst.dueDate
                      ? `Vence em ${format(inst.dueDate, "dd/MM/yyyy", { locale: ptBR })}`
                      : "Sem vencimento"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {overdue && <Badge variant="destructive">Atrasada</Badge>}
                {inst.paidAt ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11"
                    disabled={pending}
                    onClick={() => run(() => unpayInstallments([inst.id]), `Parcela ${inst.number} voltou para em aberto.`)}
                  >
                    Desfazer
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11"
                    disabled={pending}
                    onClick={() => {
                      setReceivingId(inst.id);
                      setSheetOpen(true);
                    }}
                  >
                    Receber
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <ReceiveSheet
        open={sheetOpen && target !== null}
        onOpenChange={setSheetOpen}
        title={target ? `Receber parcela ${target.number}/${target.installmentCount}` : "Receber parcela"}
        subtitle={
          target
            ? sale.customerName
              ? `${sale.customerName} · venda de ${target.saleLabel}`
              : `Venda de ${target.saleLabel}`
            : undefined
        }
        targets={target ? [target] : []}
        onReceived={handleReceived}
      />
    </section>
  );
}
