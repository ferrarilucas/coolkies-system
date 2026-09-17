"use client";

import { useRef, useTransition, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createItem, updateItem } from "@/server/actions/items";

const BASE_UNIT_LABELS: Record<string, string> = {
  G: "Grama (g)",
  ML: "Mililitro (ml)",
  UN: "Unidade (un)",
};

interface Item {
  id: string;
  name: string;
  unit: string;
  minStock: number | null;
  productionInput: boolean;
  sellable: boolean;
}

interface Props {
  mode: "create" | "edit";
  item?: Item;
}

export function ItemDialog({ mode, item }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [unit, setUnit] = useState(item?.unit ?? "G");
  const [productionInput, setProductionInput] = useState(item?.productionInput ?? true);
  const [sellable, setSellable] = useState(item?.sellable ?? false);

  function handleUnitChange(value: string) {
    setUnit(value);
    if (value !== "UN" && sellable) setSellable(false);
  }

  function handleSubmit(formData: FormData) {
    formData.set("unit", unit);
    formData.set("productionInput", productionInput ? "on" : "off");
    formData.set("sellable", sellable ? "on" : "off");
    startTransition(async () => {
      const res =
        mode === "create" ? await createItem(formData) : await updateItem(item!.id, formData);

      if (res.ok) {
        toast.success(mode === "create" ? "Insumo criado." : "Insumo atualizado.");
        setOpen(false);
        formRef.current?.reset();
      } else {
        toast.error(res.error ?? "Erro ao salvar.");
      }
    });
  }

  const unitAbbr = unit === "ML" ? "ml" : unit === "UN" ? "un" : "g";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm">
            <Plus />
            Novo insumo
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <Pencil className="size-4" />
            <span className="sr-only">Editar</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novo insumo" : "Editar insumo"}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="item-name">Nome</Label>
            <Input
              id="item-name"
              name="name"
              placeholder="Ex.: Açúcar"
              defaultValue={item?.name}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Unidade base</Label>
            <Select value={unit} onValueChange={handleUnitChange} disabled={mode === "edit"}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(BASE_UNIT_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mode === "edit" && (
              <p className="text-xs text-muted-foreground">
                A unidade base não pode ser alterada após o cadastro.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-min-stock">
              Estoque mínimo ({unitAbbr})
              <span className="ml-1 text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="item-min-stock"
              name="minStock"
              type="number"
              min="0"
              step="any"
              placeholder="0"
              defaultValue={item?.minStock ?? ""}
            />
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="item-production-input">Matéria-prima</Label>
                <p className="text-xs text-muted-foreground">Entra em receitas e produção.</p>
              </div>
              <Switch
                id="item-production-input"
                checked={productionInput}
                onCheckedChange={setProductionInput}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="item-sellable">Venda</Label>
                <p className="text-xs text-muted-foreground">Pode ser vendido no Catálogo.</p>
              </div>
              <Switch
                id="item-sellable"
                checked={sellable}
                onCheckedChange={setSellable}
                disabled={unit !== "UN"}
              />
            </div>
            {unit !== "UN" && (
              <p className="text-xs text-muted-foreground">
                Venda só é permitida para itens com unidade &quot;Unidade (un)&quot;.
              </p>
            )}
            {!productionInput && !sellable && (
              <p className="text-xs text-destructive">Marque ao menos uma das duas opções.</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || (!productionInput && !sellable)}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
