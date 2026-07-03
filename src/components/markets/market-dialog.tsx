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
import { createMarket, updateMarket } from "@/server/actions/markets";

interface Props {
  market?: { id: string; name: string };
  onCreated?: (market: { id: string; name: string }) => void;
}

export function MarketDialog({ market, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const isEdit = !!market;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      const res = isEdit
        ? await updateMarket(market.id, fd)
        : await createMarket(fd);

      if (res.ok) {
        toast.success(isEdit ? "Mercado atualizado." : "Mercado criado.");
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
        {isEdit ? <Pencil className="size-4" /> : <><Plus className="size-4" /> Novo mercado</>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar mercado" : "Novo mercado"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="market-name">Nome</Label>
              <Input
                id="market-name"
                name="name"
                defaultValue={market?.name ?? ""}
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
