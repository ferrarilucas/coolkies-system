"use client";

import { useRef, useTransition, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/shared/money-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { upsertPrice } from "@/server/actions/catalog";

// Radix Select não aceita value="" — sentinela para "nenhum sabor selecionado"
const NO_FLAVOR = "__none__";

interface Flavor {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  flavors: Flavor[];
}

interface ExistingPrice {
  id: string;
  priceCents: number;
  productId: string;
  flavorId: string | null;
}

interface Props {
  mode: "create" | "edit";
  products: Product[];
  price?: ExistingPrice;
  defaultProductId?: string;
  defaultFlavorId?: string | null;
}

export function PriceDialog({ mode, products, price, defaultProductId, defaultFlavorId }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const [selectedProduct, setSelectedProduct] = useState(
    price?.productId ?? defaultProductId ?? products[0]?.id ?? "",
  );
  const [selectedFlavor, setSelectedFlavor] = useState<string>(
    price?.flavorId ?? defaultFlavorId ?? NO_FLAVOR,
  );

  const flavors = products.find((p) => p.id === selectedProduct)?.flavors ?? [];

  function handleProductChange(val: string) {
    setSelectedProduct(val);
    setSelectedFlavor(NO_FLAVOR);
  }

  function handleSubmit(formData: FormData) {
    formData.set("productId", selectedProduct);
    // converte sentinela de volta para string vazia (= sem sabor)
    formData.set("flavorId", selectedFlavor === NO_FLAVOR ? "" : selectedFlavor);
    startTransition(async () => {
      const res = await upsertPrice(formData);
      if (res.ok) {
        toast.success("Preço salvo.");
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
            Novo preço
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <Pencil className="size-4" />
            <span className="sr-only">Editar preço</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novo preço" : "Alterar preço"}</DialogTitle>
          <DialogDescription>
            Alterar o preço não afeta vendas já registradas (snapshot).
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Produto</Label>
            <Select value={selectedProduct} onValueChange={handleProductChange} disabled={mode === "edit"}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o produto" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {flavors.length > 0 && (
            <div className="space-y-2">
              <Label>Sabor</Label>
              <Select
                value={selectedFlavor}
                onValueChange={setSelectedFlavor}
                disabled={mode === "edit"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos os sabores (genérico)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FLAVOR}>Todos os sabores (genérico)</SelectItem>
                  {flavors.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="price-value">Preço</Label>
            <MoneyInput
              id="price-value"
              name="priceCents"
              defaultValueCents={price?.priceCents ?? 0}
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
