"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { deleteProductionBatch } from "@/server/actions/production";

export function DeleteProductionButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  function handleConfirm() {
    startDelete(async () => {
      const res = await deleteProductionBatch(id);
      if (res.ok) { toast.success("Produção excluída."); setOpen(false); }
      else toast.error(res.error ?? "Erro ao excluir.");
    });
  }

  return (
    <>
      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive hover:text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir produção</DialogTitle>
            <DialogDescription>
              Isso irá reverter o estoque adicionado por esta produção. Não é possível desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={deleting}>
              {deleting ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
