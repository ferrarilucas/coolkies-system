"use client";

import { useTransition, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { MarketDialog } from "./market-dialog";
import { deleteMarket } from "@/server/actions/markets";
import type { MarketItem } from "@/server/queries/markets";

export function MarketsList({ markets }: { markets: MarketItem[] }) {
  if (markets.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhum mercado cadastrado.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {markets.map((m) => (
        <MarketRow key={m.id} market={m} />
      ))}
    </div>
  );
}

function MarketRow({ market }: { market: MarketItem }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  function handleDelete() {
    startDelete(async () => {
      const res = await deleteMarket(market.id);
      if (res.ok) { toast.success("Mercado excluído."); setDeleteOpen(false); }
      else toast.error(res.error ?? "Erro ao excluir.");
    });
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium">{market.name}</p>
          <p className="text-xs text-muted-foreground">
            {market._count.purchases} {market._count.purchases === 1 ? "compra" : "compras"} registradas
          </p>
        </div>
        <div className="flex items-center gap-1">
          <MarketDialog market={{ id: market.id, name: market.name }} />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir mercado</DialogTitle>
            <DialogDescription>
              Tem certeza? Todas as compras registradas neste mercado também serão excluídas.
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
