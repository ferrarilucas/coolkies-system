"use client";

import { useState, useTransition, type ReactNode } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { InstallmentPicker, useOpenInstallments } from "@/components/customers/installment-picker";
import { payInstallments } from "@/server/actions/sales";
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
  const [saving, startSave] = useTransition();
  const picker = useOpenInstallments(customerId, forecastTo, open);
  const { selected, selectedCents } = picker;

  const cutoff = parseForecastCutoff(forecastTo);
  const cutoffLabel = cutoff ? format(cutoff, "dd/MM/yyyy", { locale: ptBR }) : null;

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

          <InstallmentPicker {...picker} />

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
