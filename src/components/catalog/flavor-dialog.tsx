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
import { createFlavor, updateFlavor } from "@/server/actions/catalog";

const NO_RECIPE = "__none__";

interface Product { id: string; name: string }
interface Recipe { id: string; name: string }

interface Props {
  mode: "create" | "edit";
  products: Product[];
  recipes?: Recipe[];
  flavor?: { id: string; name: string; productId: string; fillingRecipeId?: string | null };
  defaultProductId?: string;
}

export function FlavorDialog({ mode, products, recipes = [], flavor, defaultProductId }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedProduct, setSelectedProduct] = useState(
    flavor?.productId ?? defaultProductId ?? products[0]?.id ?? "",
  );
  const [fillingRecipeId, setFillingRecipeId] = useState(
    flavor?.fillingRecipeId ?? NO_RECIPE,
  );

  function handleSubmit(formData: FormData) {
    formData.set("productId", selectedProduct);
    formData.set("fillingRecipeId", fillingRecipeId === NO_RECIPE ? "" : fillingRecipeId);
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createFlavor(formData)
          : await updateFlavor(flavor!.id, formData);

      if (res.ok) {
        toast.success(mode === "create" ? "Sabor criado." : "Sabor atualizado.");
        setOpen(false);
        formRef.current?.reset();
        setFillingRecipeId(NO_RECIPE);
      } else {
        toast.error(res.error ?? "Erro ao salvar.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm">
            <Plus />
            Novo sabor
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Pencil className="size-4" />
            <span className="sr-only">Editar</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novo sabor" : "Editar sabor"}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          {mode === "create" && (
            <div className="space-y-2">
              <Label>Produto</Label>
              <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="flavor-name">Nome</Label>
            <Input
              id="flavor-name"
              name="name"
              placeholder="Ex.: Chocolate"
              defaultValue={flavor?.name}
              required
              autoFocus
            />
          </div>

          {recipes.length > 0 && (
            <div className="space-y-2">
              <Label>
                Receita de recheio{" "}
                <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Select value={fillingRecipeId} onValueChange={setFillingRecipeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sem recheio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RECIPE}>Sem recheio</SelectItem>
                  {recipes.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Vincula uma receita que define os ingredientes por unidade deste recheio.
                Crie a receita em <strong>Receitas</strong> com rendimento 1 antes de vincular.
              </p>
            </div>
          )}

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
