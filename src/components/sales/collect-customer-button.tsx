"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { markCustomerSalesAsPaid } from "@/server/actions/sales";
import { formatBRL } from "@/lib/money";

export function CollectCustomerButton({
  customerId,
  customerName,
  totalCents,
  count,
}: {
  customerId: string;
  customerName: string;
  totalCents: number;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await markCustomerSalesAsPaid(customerId);
      if (res.ok && res.data) {
        toast.success(
          `${res.data.count} ${res.data.count === 1 ? "venda recebida" : "vendas recebidas"} — ${formatBRL(res.data.totalCents)}.`,
        );
        setOpen(false);
      } else {
        toast.error(res.error ?? "Erro ao registrar recebimento.");
      }
    });
  }

  return (
    <>
      <Button className="w-full" size="lg" onClick={() => setOpen(true)}>
        <HandCoins />
        Receber tudo de {customerName} · {formatBRL(totalCents)}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receber pagamentos</DialogTitle>
            <DialogDescription>
              Marcar como {count === 1 ? "paga a venda pendente" : `pagas as ${count} vendas pendentes`}{" "}
              de <strong>{customerName}</strong>, totalizando{" "}
              <strong>{formatBRL(totalCents)}</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={pending}>
              {pending ? "Registrando…" : "Confirmar recebimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
