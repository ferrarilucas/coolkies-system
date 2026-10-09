"use client";

import { useTransition } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { payInstallments, unpayInstallments } from "@/server/actions/sales";
import { formatBRL } from "@/lib/money";

type Installment = { id: string; number: number; amountCents: number; dueDate: Date | null; paidAt: Date | null };

export function SaleInstallments({ installments }: { installments: Installment[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const total = installments.reduce((max, i) => Math.max(max, i.number), installments.length);

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
                    disabled={pending}
                    onClick={() => run(() => unpayInstallments([inst.id]), `Parcela ${inst.number} voltou para em aberto.`)}
                  >
                    Desfazer
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => payInstallments([inst.id]), `Parcela ${inst.number} recebida.`)}
                  >
                    Receber
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
