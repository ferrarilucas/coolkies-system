"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAsPaid, markAsPending } from "@/server/actions/sales";

export function MarkAsPaidButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await markAsPaid(id);
      if (!res.ok) {
        toast.error(res.error ?? "Erro ao atualizar.");
        return;
      }
      const previous = res.data;
      toast.success("Venda marcada como paga.", {
        action: {
          label: "Desfazer",
          onClick: () => {
            void markAsPending(
              id,
              previous?.forecastDate ?? null,
              previous?.forecastPreset ?? null,
            ).then((r) => {
              if (r.ok) toast.success("Venda voltou para pendente.");
              else toast.error(r.error ?? "Erro ao desfazer.");
            });
          },
        },
      });
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
      {pending ? "Salvando..." : "Marcar como pago"}
    </Button>
  );
}
