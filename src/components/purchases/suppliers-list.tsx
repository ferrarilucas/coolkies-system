"use client";

import { useTransition, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { SupplierDialog } from "./supplier-dialog";
import { deleteSupplier } from "@/server/actions/purchases";
import type { SupplierItem } from "@/server/queries/purchases";

export function SuppliersList({ suppliers }: { suppliers: SupplierItem[] }) {
  if (suppliers.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhum fornecedor cadastrado.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {suppliers.map((s) => (
        <SupplierRow key={s.id} supplier={s} />
      ))}
    </div>
  );
}

function SupplierRow({ supplier }: { supplier: SupplierItem }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  function handleDelete() {
    startDelete(async () => {
      const res = await deleteSupplier(supplier.id);
      if (res.ok) { toast.success("Fornecedor excluído."); setDeleteOpen(false); }
      else toast.error(res.error ?? "Erro ao excluir.");
    });
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium">{supplier.name}</p>
          <p className="text-xs text-muted-foreground">
            {supplier._count.purchases} {supplier._count.purchases === 1 ? "compra" : "compras"} registradas
          </p>
        </div>
        <div className="flex items-center gap-1">
          <SupplierDialog supplier={{ id: supplier.id, name: supplier.name }} />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir fornecedor</DialogTitle>
            <DialogDescription>
              Tem certeza? As compras registradas com este fornecedor não serão excluídas, apenas perdem o vínculo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
