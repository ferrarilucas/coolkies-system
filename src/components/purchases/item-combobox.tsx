"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createItemForPurchase } from "@/server/actions/items";
import { toast } from "sonner";

export type PurchaseItemOption = {
  id: string;
  name: string;
  unit: string;
  sellable: boolean;
};

function QuickCreateForm({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (item: PurchaseItemOption) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState("G");
  const [productionInput, setProductionInput] = useState(true);
  const [sellable, setSellable] = useState(false);
  const [saving, startSave] = useTransition();

  function handleUnitChange(value: string) {
    setUnit(value);
    if (value !== "UN" && sellable) setSellable(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || (!productionInput && !sellable)) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("unit", unit);
    fd.set("productionInput", productionInput ? "on" : "off");
    fd.set("sellable", sellable ? "on" : "off");
    startSave(async () => {
      const res = await createItemForPurchase(fd);
      if (res.ok && res.data) {
        toast.success(`"${res.data.name}" criado.`);
        onCreated({
          id: res.data.id,
          name: res.data.name,
          unit: res.data.unit,
          sellable: res.data.sellable,
        });
      } else {
        toast.error(res.error ?? "Erro ao criar.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Novo insumo
      </p>
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Nome *</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            placeholder="Ex.: Refrigerante lata"
          />
        </div>
        <div>
          <Label className="text-xs">Unidade base</Label>
          <Select value={unit} onValueChange={handleUnitChange}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="G">Grama (g)</SelectItem>
              <SelectItem value="ML">Mililitro (ml)</SelectItem>
              <SelectItem value="UN">Unidade (un)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Matéria-prima</Label>
          <Switch checked={productionInput} onCheckedChange={setProductionInput} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Venda</Label>
          <Switch checked={sellable} onCheckedChange={setSellable} disabled={unit !== "UN"} />
        </div>
        {unit !== "UN" && (
          <p className="text-xs text-muted-foreground">
            Venda só é permitida para insumos com unidade &quot;Unidade (un)&quot;.
          </p>
        )}
        {!productionInput && !sellable && (
          <p className="text-xs text-destructive">Marque ao menos uma das duas opções.</p>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          type="submit"
          size="sm"
          className="flex-1"
          disabled={saving || !name.trim() || (!productionInput && !sellable)}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Criar
        </Button>
      </div>
    </form>
  );
}

interface Props {
  value: PurchaseItemOption | null;
  onChange: (v: PurchaseItemOption) => void;
  options: PurchaseItemOption[];
  onOptionCreated: (v: PurchaseItemOption) => void;
}

const UNIT_ABBR: Record<string, string> = { G: "g", ML: "ml", UN: "un" };

export function PurchaseItemCombobox({ value, onChange, options, onOptionCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setShowCreate(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));

  function handleSelect(o: PurchaseItemOption) {
    onChange(o);
    setOpen(false);
  }

  function handleCreated(item: PurchaseItemOption) {
    onOptionCreated(item);
    onChange(item);
    setShowCreate(false);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">{value.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                ({UNIT_ABBR[value.unit] ?? value.unit.toLowerCase()})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Insumo…</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {showCreate ? (
          <QuickCreateForm initialName={query} onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
        ) : (
          <>
            <div className="flex items-center border-b px-3 py-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar insumo…"
                className="h-7 border-0 p-0 shadow-none focus-visible:ring-0 text-sm"
              />
            </div>

            <div className="max-h-52 overflow-y-auto">
              {filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleSelect(o)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                >
                  <Check className={cn("size-4 shrink-0", value?.id === o.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{o.name}</span>
                  {o.sellable && <span className="text-xs text-muted-foreground">venda</span>}
                </button>
              ))}

              {filtered.length === 0 && (
                <div className="px-3 py-2 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {query ? `Nenhum resultado para "${query}".` : "Nenhum insumo cadastrado."}
                  </p>
                  <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setShowCreate(true)}>
                    <Plus className="size-3.5" />
                    {query ? `Criar "${query}"` : "Criar insumo"}
                  </Button>
                </div>
              )}

              {filtered.length > 0 && (
                <div className="border-t px-3 py-2">
                  <Button type="button" variant="ghost" size="sm" className="w-full gap-1.5 text-xs text-muted-foreground" onClick={() => setShowCreate(true)}>
                    <Plus className="size-3.5" />
                    {query ? `Criar "${query}"` : "Criar novo insumo"}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
