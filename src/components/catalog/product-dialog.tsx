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
import { createProduct, updateProduct } from "@/server/actions/catalog";

interface Props {
  mode: "create" | "edit";
  product?: { id: string; name: string };
}

export function ProductDialog({ mode, product }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createProduct(formData)
          : await updateProduct(product!.id, formData);

      if (res.ok) {
        toast.success(mode === "create" ? "Produto criado." : "Produto atualizado.");
        setOpen(false);
        formRef.current?.reset();
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
            Novo produto
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
          <DialogTitle>{mode === "create" ? "Novo produto" : "Editar produto"}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product-name">Nome</Label>
            <Input
              id="product-name"
              name="name"
              placeholder="Ex.: Cookie"
              defaultValue={product?.name}
              required
              autoFocus
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
