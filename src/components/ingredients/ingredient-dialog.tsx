"use client";

import { useRef, useTransition, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createIngredient, updateIngredient } from "@/server/actions/ingredients";

const BASE_UNIT_LABELS: Record<string, string> = {
  G: "Grama (g)",
  ML: "Mililitro (ml)",
  UN: "Unidade (un)",
};

interface Ingredient {
  id: string;
  name: string;
  baseUnit: string;
  minStock: number | null;
}

interface Props {
  mode: "create" | "edit";
  ingredient?: Ingredient;
}

export function IngredientDialog({ mode, ingredient }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [baseUnit, setBaseUnit] = useState(ingredient?.baseUnit ?? "G");

  function handleSubmit(formData: FormData) {
    formData.set("baseUnit", baseUnit);
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createIngredient(formData)
          : await updateIngredient(ingredient!.id, formData);

      if (res.ok) {
        toast.success(mode === "create" ? "Ingrediente criado." : "Ingrediente atualizado.");
        setOpen(false);
        formRef.current?.reset();
      } else {
        toast.error(res.error ?? "Erro ao salvar.");
      }
    });
  }

  const unitAbbr = baseUnit === "ML" ? "ml" : baseUnit === "UN" ? "un" : "g";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm">
            <Plus />
            Novo ingrediente
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
          <DialogTitle>
            {mode === "create" ? "Novo ingrediente" : "Editar ingrediente"}
          </DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ing-name">Nome</Label>
            <Input
              id="ing-name"
              name="name"
              placeholder="Ex.: Açúcar"
              defaultValue={ingredient?.name}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Unidade base</Label>
            <Select
              value={baseUnit}
              onValueChange={setBaseUnit}
              disabled={mode === "edit"}
            >
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
            <Label htmlFor="ing-min-stock">
              Estoque mínimo ({unitAbbr})
              <span className="ml-1 text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="ing-min-stock"
              name="minStock"
              type="number"
              min="0"
              step="any"
              placeholder="0"
              defaultValue={ingredient?.minStock ?? ""}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
