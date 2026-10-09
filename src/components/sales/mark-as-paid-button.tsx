"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { payNextInstallment, unpayInstallments } from "@/server/actions/sales";

export function MarkAsPaidButton({ id, parceled }: { id: string; parceled: boolean }) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await payNextInstallment(id);
      if (!res.ok || !res.data) {
        toast.error(res.error ?? "Erro ao atualizar.");
        return;
      }
      const { installmentId, number, installmentCount } = res.data;
      toast.success(
        installmentCount > 1 ? `Parcela ${number}/${installmentCount} recebida.` : "Venda marcada como paga.",
        {
          action: {
            label: "Desfazer",
            onClick: () => {
              void unpayInstallments([installmentId]).then((r) => {
                if (r.ok) toast.success(installmentCount > 1 ? "Parcela voltou para em aberto." : "Venda voltou para pendente.");
                else toast.error(r.error ?? "Erro ao desfazer.");
              });
            },
          },
        },
      );
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-success border-success/40 hover:bg-success/10 hover:text-success"
      onClick={handleClick}
      disabled={pending}
    >
      <CheckCircle className="size-3.5" />
      {pending ? "Salvando..." : parceled ? "Receber parcela" : "Marcar como pago"}
    </Button>
  );
}
