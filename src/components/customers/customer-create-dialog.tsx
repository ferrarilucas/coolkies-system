"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { createCustomer } from "@/server/actions/customers";

interface Props {
  trigger?: React.ReactNode;
}

export function CustomerCreateDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      const res = await createCustomer(fd);
      if (res.ok) {
        toast.success("Cliente criado.");
        setOpen(false);
      } else {
        toast.error(res.error ?? "Erro ao criar.");
      }
    });
  }

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Novo cliente
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input id="name" name="name" placeholder="Nome do cliente" autoFocus required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sector">Setor <span className="text-muted-foreground">(opcional)</span></Label>
                <Input id="sector" name="sector" placeholder="Ex.: Empresa" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone <span className="text-muted-foreground">(opcional)</span></Label>
                <PhoneInput id="phone" name="phone" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail <span className="text-muted-foreground">(opcional)</span></Label>
              <Input id="email" name="email" type="email" placeholder="email@exemplo.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Observações <span className="text-muted-foreground">(opcional)</span></Label>
              <Textarea id="notes" name="notes" rows={2} placeholder="Alguma anotação…" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Criando…" : "Criar cliente"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
