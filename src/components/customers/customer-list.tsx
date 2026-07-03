"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, ShoppingCart, Mail, Phone, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { updateCustomer, deleteCustomer } from "@/server/actions/customers";
import type { CustomerFull } from "@/server/queries/customers";

export function CustomerList({ customers }: { customers: CustomerFull[] }) {
  return (
    <div className="space-y-2">
      {customers.map((c) => (
        <CustomerCard key={c.id} customer={c} />
      ))}
    </div>
  );
}

function CustomerCard({ customer }: { customer: CustomerFull }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      const res = await updateCustomer(customer.id, fd);
      if (res.ok) { toast.success("Cliente atualizado."); setEditOpen(false); }
      else toast.error(res.error ?? "Erro ao atualizar.");
    });
  }

  function handleDelete() {
    startDelete(async () => {
      const res = await deleteCustomer(customer.id);
      if (res.ok) { toast.success("Cliente excluído."); setDeleteOpen(false); }
      else toast.error(res.error ?? "Erro ao excluir.");
    });
  }

  return (
    <>
      <div className="rounded-lg border bg-card px-4 py-3 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{customer.name}</span>
            {customer.sector && (
              <Badge variant="secondary" className="text-xs">{customer.sector}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {customer.email && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Mail className="size-3" />{customer.email}
              </span>
            )}
            {customer.phone && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="size-3" />{customer.phone}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ShoppingCart className="size-3" />
              {customer._count.sales} {customer._count.sales === 1 ? "venda" : "vendas"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Dialog de edição */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Editar cliente</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nome *</Label>
              <Input id="edit-name" name="name" defaultValue={customer.name} required autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-sector">Setor</Label>
                <Input id="edit-sector" name="sector" defaultValue={customer.sector ?? ""} placeholder="Ex.: Empresa" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Telefone</Label>
                <PhoneInput id="edit-phone" name="phone" defaultValue={customer.phone ?? ""} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">E-mail</Label>
              <Input id="edit-email" name="email" type="email" defaultValue={customer.email ?? ""} placeholder="email@exemplo.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Observações</Label>
              <Textarea id="edit-notes" name="notes" rows={2} defaultValue={customer.notes ?? ""} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog de exclusão */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir cliente</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir <strong>{customer.name}</strong>?
              As vendas vinculadas não serão excluídas, apenas o vínculo será removido.
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
