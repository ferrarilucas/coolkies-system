"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { deleteSale } from "@/server/actions/sales";

export function DeleteSaleButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await deleteSale(id);
      if (res.ok) { toast.success("Venda excluída."); setOpen(false); }
      else toast.error(res.error ?? "Erro ao excluir.");
    });
  }

  return (
    <>
      <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
        <span className="sr-only">Excluir</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir venda</DialogTitle>
            <DialogDescription>
              Tem certeza? Esta ação não pode ser desfeita e irá reverter a movimentação de estoque.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
              {pending ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
