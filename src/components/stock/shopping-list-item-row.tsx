"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Trash2, ShoppingCart, Pencil, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatQty, baseUnitLabel } from "@/lib/units";
import { toggleShoppingListItem, deleteShoppingListItem, updateShoppingListItem } from "@/server/actions/shopping-list";
import type { BaseUnit } from "@prisma/client";

const EDIT_UNITS: BaseUnit[] = ["G", "ML", "UN"];
const NO_UNIT = "__none__";

export function ShoppingListItemRow({
  id, itemId, label, quantity, unit,
}: {
  id: string; itemId: string | null; label: string; quantity: number | null; unit: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(label);
  const [editQuantity, setEditQuantity] = useState(quantity != null ? String(quantity) : "");
  const [editUnit, setEditUnit] = useState(unit ?? NO_UNIT);

  function onCheckedChange(checked: boolean) {
    startTransition(async () => {
      const res = await toggleShoppingListItem(id, checked);
      if (!res.ok) toast.error(res.error ?? "Não foi possível atualizar o item.");
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const res = await deleteShoppingListItem(id);
      if (!res.ok) toast.error(res.error ?? "Não foi possível remover o item.");
      router.refresh();
    });
  }

  function startEdit() {
    setEditLabel(label);
    setEditQuantity(quantity != null ? String(quantity) : "");
    setEditUnit(unit ?? NO_UNIT);
    setIsEditing(true);
  }

  function onSave() {
    if (!editLabel.trim()) return;
    const fd = new FormData();
    fd.set("label", editLabel.trim());
    fd.set("quantity", editQuantity.trim());
    fd.set("unit", editUnit === NO_UNIT ? "" : editUnit);
    startTransition(async () => {
      const res = await updateShoppingListItem(id, fd);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível salvar.");
        return;
      }
      setIsEditing(false);
      router.refresh();
    });
  }

  if (isEditing) {
    return (
      <div className="space-y-2 rounded-lg border bg-card px-4 py-3">
        <Input
          value={editLabel}
          onChange={(e) => setEditLabel(e.target.value)}
          placeholder="Descrição"
          disabled={pending}
        />
        <div className="flex gap-2">
          <Input
            type="number"
            step="any"
            min="0"
            value={editQuantity}
            onChange={(e) => setEditQuantity(e.target.value)}
            placeholder="Quantidade"
            disabled={pending}
            className="flex-1"
          />
          <Select value={editUnit} onValueChange={setEditUnit} disabled={pending}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_UNIT}>Sem unidade</SelectItem>
              {EDIT_UNITS.map((u) => (
                <SelectItem key={u} value={u}>{baseUnitLabel(u)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="icon" variant="ghost" disabled={pending} onClick={() => setIsEditing(false)} title="Cancelar">
            <X className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" disabled={pending || !editLabel.trim()} onClick={onSave} title="Salvar">
            <Check className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <Switch checked={false} disabled={pending} onCheckedChange={onCheckedChange} aria-label="Marcar como comprado" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        {quantity != null && (
          <p className="text-xs text-muted-foreground">
            {unit != null ? formatQty(quantity, unit as BaseUnit) : quantity}
          </p>
        )}
      </div>
      {itemId && (
        <Button asChild size="icon" variant="ghost" title="Registrar compra">
          <Link href={`/purchases?itemId=${itemId}`}><ShoppingCart className="size-4" /></Link>
        </Button>
      )}
      <Button size="icon" variant="ghost" disabled={pending} onClick={startEdit} title="Editar">
        <Pencil className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" disabled={pending} onClick={onDelete} title="Remover">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
