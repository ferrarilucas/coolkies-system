"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Check, ChevronsUpDown, Plus, Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchCustomers, type CustomerSummary } from "@/server/queries/customers";
import { createCustomer } from "@/server/actions/customers";
import { toast } from "sonner";

// ─── Formulário rápido de novo cliente ───────────────────────────────────────

interface QuickCreateFormProps {
  initialName: string;
  onCreated: (customer: CustomerSummary) => void;
  onCancel: () => void;
}

function QuickCreateForm({ initialName, onCreated, onCancel }: QuickCreateFormProps) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sector, setSector] = useState("");
  const [creating, startCreate] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    startCreate(async () => {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("email", email.trim());
      fd.set("phone", phone.trim());
      fd.set("sector", sector.trim());
      const res = await createCustomer(fd);
      if (res.ok && res.data) {
        toast.success("Cliente criado.");
        onCreated(res.data);
      } else {
        toast.error(res.error ?? "Erro ao criar cliente.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Novo cliente
      </p>
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Nome *</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do cliente"
            className="h-8 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Setor</Label>
            <Input
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="Ex.: Empresa"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Telefone</Label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              className="h-8 text-sm"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">E-mail</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@exemplo.com"
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={onCancel} disabled={creating}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" className="flex-1" disabled={creating || !name.trim()}>
          {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Criar
        </Button>
      </div>
    </form>
  );
}

// ─── Combobox principal ───────────────────────────────────────────────────────

interface CustomerComboboxProps {
  value: CustomerSummary | null;
  onChange: (customer: CustomerSummary | null) => void;
}

export function CustomerCombobox({ value, onChange }: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Busca com debounce
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchCustomers(query);
        setResults(data);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  // Carrega resultados ao abrir
  useEffect(() => {
    if (open) {
      setQuery("");
      setShowCreate(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  function handleSelect(customer: CustomerSummary) {
    onChange(customer);
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
  }

  function handleCreated(customer: CustomerSummary) {
    onChange(customer);
    setShowCreate(false);
    setOpen(false);
  }

  const noResults = !loading && results.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="flex items-center gap-2 min-w-0">
              <User className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{value.name}</span>
              {value.sector && (
                <span className="text-xs text-muted-foreground shrink-0">· {value.sector}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Selecionar ou criar cliente…</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {showCreate ? (
          <QuickCreateForm
            initialName={query}
            onCreated={handleCreated}
            onCancel={() => setShowCreate(false)}
          />
        ) : (
          <>
            {/* Campo de busca */}
            <div className="flex items-center border-b px-3 py-2 gap-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar cliente…"
                className="h-7 border-0 p-0 shadow-none focus-visible:ring-0 text-sm"
              />
              {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />}
            </div>

            {/* Lista de resultados */}
            <div className="max-h-60 overflow-y-auto">
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                >
                  <Check
                    className={cn("size-4 shrink-0", value?.id === c.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    {(c.sector || c.phone) && (
                      <span className="block text-xs text-muted-foreground truncate">
                        {[c.sector, c.phone].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
              ))}

              {noResults && query.trim() ? (
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-2">Nenhum cliente encontrado.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => setShowCreate(true)}
                  >
                    <Plus className="size-3.5" />
                    Criar &quot;{query}&quot;
                  </Button>
                </div>
              ) : noResults ? (
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-2">Nenhum cliente cadastrado ainda.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => setShowCreate(true)}
                  >
                    <Plus className="size-3.5" />
                    Criar novo cliente
                  </Button>
                </div>
              ) : null}

              {/* Sempre mostra "criar novo" quando há resultados mas o usuário quer outro */}
              {results.length > 0 && (
                <div className="border-t px-3 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full gap-1.5 text-xs text-muted-foreground"
                    onClick={() => setShowCreate(true)}
                  >
                    <Plus className="size-3.5" />
                    {query.trim() ? `Criar "${query}"` : "Criar novo cliente"}
                  </Button>
                </div>
              )}
            </div>

            {/* Limpar seleção */}
            {value && (
              <div className="border-t px-3 py-2">
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs text-muted-foreground hover:text-foreground w-full text-left"
                >
                  Limpar seleção
                </button>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
