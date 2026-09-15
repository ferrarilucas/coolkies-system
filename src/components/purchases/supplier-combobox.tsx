"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createSupplierInline } from "@/server/actions/purchases";
import { toast } from "sonner";

export type SupplierOption = { id: string; name: string };

interface Props {
  value: SupplierOption | null;
  onChange: (v: SupplierOption | null) => void;
  options: SupplierOption[];
  onOptionCreated: (v: SupplierOption) => void;
}

export function SupplierCombobox({ value, onChange, options, onOptionCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, startCreate] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));

  function handleSelect(o: SupplierOption | null) {
    onChange(o);
    setOpen(false);
  }

  function handleCreate() {
    const name = query.trim();
    if (!name) return;
    const fd = new FormData();
    fd.set("name", name);
    startCreate(async () => {
      const res = await createSupplierInline(fd);
      if (res.ok && res.data) {
        toast.success(`"${res.data.name}" criado.`);
        onOptionCreated(res.data);
        onChange(res.data);
        setOpen(false);
      } else {
        toast.error(res.error ?? "Erro ao criar.");
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value ? <span className="truncate">{value.name}</span> : <span className="text-muted-foreground">Fornecedor (opcional)…</span>}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="flex items-center border-b px-3 py-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ou criar fornecedor…"
            className="h-7 border-0 p-0 shadow-none focus-visible:ring-0 text-sm"
          />
        </div>

        <div className="max-h-52 overflow-y-auto">
          {value && (
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left text-muted-foreground"
            >
              Sem fornecedor
            </button>
          )}
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => handleSelect(o)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
            >
              <Check className={cn("size-4 shrink-0", value?.id === o.id ? "opacity-100" : "opacity-0")} />
              <span className="flex-1 truncate">{o.name}</span>
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {query ? `Nenhum resultado para "${query}".` : "Nenhum fornecedor cadastrado."}
            </p>
          )}

          {query.trim() && !filtered.some((o) => o.name.toLowerCase() === query.trim().toLowerCase()) && (
            <div className="border-t px-3 py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Criar &quot;{query.trim()}&quot;
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
