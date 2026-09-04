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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 rounded-lg border bg-card p-3 sm:flex-nowrap sm:gap-4 sm:px-4">
        <div className="order-1 min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{customer.name}</span>
            <SectorBadge sector={customer.sector} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {customer.email && (
              <span className="flex min-w-0 max-w-full items-center gap-1">
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{customer.email}</span>
              </span>
            )}
            {customer.phone && (
              <span className="flex shrink-0 items-center gap-1">
                <Phone className="size-3" />
                {customer.phone}
              </span>
            )}
            <span className="flex shrink-0 items-center gap-1">
              <ShoppingCart className="size-3" />
              {customer._count.sales} {customer._count.sales === 1 ? "venda" : "vendas"}
            </span>
          </div>
          {customer.pendingCents > 0 && (
            <p
              className={
                customer.isOverdue
                  ? "mt-1.5 flex items-center gap-1 text-xs font-medium text-destructive"
                  : "mt-1.5 flex items-center gap-1 text-xs font-medium text-warning-text"
              }
            >
              {customer.isOverdue && <AlertTriangle className="size-3 shrink-0" />}
              <span className="tabular-nums">{formatBRL(customer.pendingCents)}</span>
              <span>
                em {customer.pendingCount}{" "}
                {customer.pendingCount === 1 ? "pendência" : "pendências"}
              </span>
            </p>
          )}
        </div>

        <div className="order-2 shrink-0 sm:order-3">
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

        {customer.pendingCents > 0 && (
          <div className="order-3 w-full sm:order-2 sm:w-auto">
            <CustomerCollectDialog
              customerId={customer.id}
              customerName={customer.name}
              customerSector={customer.sector}
              pendingCents={customer.pendingCents}
              pendingCount={customer.pendingCount}
              forecastTo={forecastTo}
              triggerClassName="w-full sm:w-auto"
            />
          </div>
        )}
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
