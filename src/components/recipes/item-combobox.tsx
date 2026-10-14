"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createItemInline } from "@/server/actions/recipes";
import { toast } from "sonner";
import type { ItemOption } from "./recipe-form";

// ─── Criação rápida de matéria-prima ──────────────────────────────────────────

const UNIT_CHOICES = [
  { value: "G", label: "Peso", hint: "g / kg" },
  { value: "ML", label: "Volume", hint: "ml / L" },
  { value: "UN", label: "Unidade", hint: "un" },
] as const;

function QuickCreateDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  onCreated: (item: ItemOption) => void;
}) {
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState<string>("G");
  const [saving, startSave] = useTransition();

  useEffect(() => {
    if (open) {
      setName(initialName);
      setUnit("G");
    }
  }, [open, initialName]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("unit", unit);
    startSave(async () => {
      const res = await createItemInline(fd);
      if (res.ok && res.data) {
        toast.success(`"${res.data.name}" criado.`);
        onCreated({
          id: res.data.id,
          name: res.data.name,
          unit: res.data.unit,
          unitCostCents: null,
        });
      } else {
        toast.error(res.error ?? "Erro ao criar.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        className={cn(
          "top-4 w-[calc(100%-2rem)] max-w-sm translate-y-0 rounded-lg",
          "sm:top-[50%] sm:translate-y-[-50%]",
        )}
      >
        <DialogHeader>
          <DialogTitle>Nova matéria-prima</DialogTitle>
          <DialogDescription>
            Fica disponível nas fichas técnicas e nas compras. Não aparece para venda.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quick-item-name">Nome</Label>
            <Input
              id="quick-item-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Farinha de trigo"
              className="h-11 text-base"
            />
          </div>
          <div className="space-y-2">
            <Label>Medido em</Label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Medido em">
              {UNIT_CHOICES.map((u) => (
                <button
                  key={u.value}
                  type="button"
                  role="radio"
                  aria-checked={unit === u.value}
                  onClick={() => setUnit(u.value)}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-md border px-2 py-2.5 text-sm transition-colors",
                    unit === u.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <span className="font-medium">{u.label}</span>
                  <span className="text-xs text-muted-foreground">{u.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Criar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Combobox ─────────────────────────────────────────────────────────────────

interface Props {
  value: ItemOption | null;
  /** Chamado quando o usuário seleciona OU cria um item */
  onChange: (v: ItemOption) => void;
  options: ItemOption[];
  /** Notifica o pai que um novo item foi criado (para atualizar a lista global) */
  onOptionCreated: (v: ItemOption) => void;
  /** IDs de itens já usados em OUTRAS linhas — não aparecem na lista */
  usedIds?: Set<string>;
}

const UNIT_ABBR: Record<string, string> = { G: "g", ML: "ml", UN: "un" };

export function ItemCombobox({
  value,
  onChange,
  options,
  onOptionCreated,
  usedIds,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Filtra: exclui itens já usados em OUTRAS linhas (usedIds já não contém o atual)
  const available = options.filter(
    (o) => !usedIds?.has(o.id),
  );
  const filtered = available.filter((o) =>
    o.name.toLowerCase().includes(query.toLowerCase()),
  );

  function handleSelect(o: ItemOption) {
    onChange(o);
    setOpen(false);
  }

  function startCreate() {
    setCreateName(query.trim());
    setOpen(false);
    setCreateOpen(true);
  }

  function handleCreated(item: ItemOption) {
    onOptionCreated(item);
    onChange(item);
    setCreateOpen(false);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between font-normal"
          >
            {value ? (
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">{value.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  ({UNIT_ABBR[value.unit] ?? value.unit.toLowerCase()})
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Item…</span>
            )}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          {/* Busca */}
          <div className="flex items-center border-b px-3 py-2">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar item…"
              className="h-8 border-0 p-0 shadow-none focus-visible:ring-0 text-base sm:text-sm"
            />
          </div>

          {/* Lista */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => handleSelect(o)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent text-left"
              >
                <Check
                  className={cn(
                    "size-4 shrink-0",
                    value?.id === o.id ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate">{o.name}</span>
                <span className="text-xs text-muted-foreground">
                  {UNIT_ABBR[o.unit] ?? o.unit.toLowerCase()}
                </span>
              </button>
            ))}

            {filtered.length === 0 && (
              <div className="px-3 py-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {query
                    ? `Nenhum resultado para "${query}".`
                    : available.length === 0
                      ? "Todos os itens já estão adicionados."
                      : "Nenhum item disponível."}
                </p>
                {(query || available.length === 0) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={startCreate}
                  >
                    <Plus className="size-3.5" />
                    {query ? `Criar "${query}"` : "Criar matéria-prima"}
                  </Button>
                )}
              </div>
            )}

            {filtered.length > 0 && (
              <div className="border-t px-3 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full gap-1.5 text-xs text-muted-foreground"
                  onClick={startCreate}
                >
                  <Plus className="size-3.5" />
                  {query ? `Criar "${query}"` : "Criar matéria-prima"}
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <QuickCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialName={createName}
        onCreated={handleCreated}
      />
    </>
  );
}
