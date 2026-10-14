"use client";

import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { payInstallments, unpayLastCollection, unpayLastInstallment } from "@/server/actions/sales";
import { formatBRL } from "@/lib/money";

function redo(installmentIds: string[]) {
  void payInstallments(installmentIds).then((r) => {
    if (r.ok) toast.success("Recebimento restaurado.");
    else toast.error(r.error ?? "Erro ao desfazer.");
  });
}

export function UnpaySaleMenuItem({ id, parceled }: { id: string; parceled: boolean }) {
  function handleSelect() {
    void unpayLastInstallment(id).then((res) => {
      if (!res.ok || !res.data) {
        toast.error(res.error ?? "Erro ao atualizar.");
        return;
      }
      const { installmentId, number, installmentCount } = res.data;
      toast.success(
        installmentCount > 1
          ? `Parcela ${number}/${installmentCount} voltou para em aberto.`
          : "Venda voltou para pendente.",
        { action: { label: "Desfazer", onClick: () => redo([installmentId]) } },
      );
    });
  }

  return (
    <DropdownMenuItem onSelect={handleSelect}>
      <Undo2 />
      {parceled ? "Desfazer última parcela" : "Marcar como não pago"}
    </DropdownMenuItem>
  );
}

export function UndoLastCollectionMenuItem({ customerId }: { customerId: string }) {
  function handleSelect() {
    void unpayLastCollection(customerId).then((res) => {
      if (!res.ok || !res.data) {
        toast.error(res.error ?? "Erro ao atualizar.");
        return;
      }
      const { installmentIds, count, totalCents } = res.data;
      toast.success(
        `${count} ${count === 1 ? "parcela voltou" : "parcelas voltaram"} para em aberto — ${formatBRL(totalCents)}.`,
        { action: { label: "Desfazer", onClick: () => redo(installmentIds) } },
      );
    });
  }

  return (
    <DropdownMenuItem onSelect={handleSelect}>
      <Undo2 />
      Desfazer último recebimento
    </DropdownMenuItem>
  );
}
