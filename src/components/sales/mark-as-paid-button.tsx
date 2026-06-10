"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAsPaid } from "@/server/actions/sales";

export function MarkAsPaidButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await markAsPaid(id);
      if (res.ok) toast.success("Venda marcada como paga.");
      else toast.error(res.error ?? "Erro ao atualizar.");
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
