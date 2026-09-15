"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { createSupplierInline, updateSupplier } from "@/server/actions/purchases";

interface Props {
  supplier?: { id: string; name: string };
  onCreated?: (supplier: { id: string; name: string }) => void;
}

export function SupplierDialog({ supplier, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const isEdit = !!supplier;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      const res = isEdit
        ? await updateSupplier(supplier.id, fd)
        : await createSupplierInline(fd);

      if (res.ok) {
        toast.success(isEdit ? "Fornecedor atualizado." : "Fornecedor criado.");
        setOpen(false);
        if (!isEdit && res.data) onCreated?.(res.data);
      } else {
        toast.error(res.error ?? "Erro ao salvar.");
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={isEdit ? "ghost" : "default"}
        className={isEdit ? "h-9 w-9 p-0" : ""}
        onClick={() => setOpen(true)}
      >
        {isEdit ? <Pencil className="size-4" /> : <><Plus className="size-4" /> Novo fornecedor</>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier-name">Nome</Label>
              <Input
                id="supplier-name"
                name="name"
                defaultValue={supplier?.name ?? ""}
                placeholder="Ex.: Atacadão"
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando…" : isEdit ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
