"use client";

import { useState, useTransition } from "react";
import { ShoppingCart, Mail, Phone, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectorBadge } from "@/components/customers/customer-name";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { RowActions } from "@/components/shared/row-actions";
import { CustomerCollectDialog } from "@/components/customers/customer-collect-dialog";
import { updateCustomer, deleteCustomer } from "@/server/actions/customers";
import { formatBRL } from "@/lib/money";
import type { CustomerWithBalance } from "@/server/queries/customers";

export function CustomerList({
  customers,
  forecastTo,
}: {
  customers: CustomerWithBalance[];
  forecastTo?: string;
}) {
  return (
    <div className="space-y-2">
      {customers.map((c) => (
        <CustomerCard key={c.id} customer={c} forecastTo={forecastTo} />
      ))}
    </div>
  );
}

function CustomerCard({
  customer,
  forecastTo,
}: {
  customer: CustomerWithBalance;
  forecastTo?: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [saving, startSave] = useTransition();

  function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      const res = await updateCustomer(customer.id, fd);
      if (res.ok) { toast.success("Cliente atualizado."); setEditOpen(false); }
      else toast.error(res.error ?? "Erro ao atualizar.");
    });
  }

  return (
    <>
      <div className="rounded-lg border bg-card px-4 py-3 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{customer.name}</span>
            <SectorBadge sector={customer.sector} />
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
            {customer.pendingCents > 0 && (
              <span
                className={
                  customer.isOverdue
                    ? "flex items-center gap-1 text-xs font-medium text-destructive"
                    : "flex items-center gap-1 text-xs font-medium text-warning-text"
                }
              >
                {customer.isOverdue && <AlertTriangle className="size-3" />}
                {formatBRL(customer.pendingCents)} em {customer.pendingCount}{" "}
                {customer.pendingCount === 1 ? "pendência" : "pendências"}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {customer.pendingCents > 0 && (
            <CustomerCollectDialog
              customerId={customer.id}
              customerName={customer.name}
              customerSector={customer.sector}
              pendingCents={customer.pendingCents}
              pendingCount={customer.pendingCount}
              forecastTo={forecastTo}
            />
          )}
          <RowActions
            onEdit={() => setEditOpen(true)}
            deleteTitle="Excluir cliente"
            deleteDescription={
              <>
                Tem certeza que deseja excluir <strong>{customer.name}</strong>?
                As vendas vinculadas não serão excluídas, apenas o vínculo será removido.
              </>
            }
            deleteSuccessMessage="Cliente excluído."
            onDelete={() => deleteCustomer(customer.id)}
          />
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

    </>
  );
}
