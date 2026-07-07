"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronsUpDown, Loader2, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchCustomersPage, type CustomerSummary } from "@/server/queries/customers";

export function CustomerFilterCombobox({
  selected,
  onSelect,
}: {
  selected: CustomerSummary | null;
  onSelect: (customer: CustomerSummary | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchCustomersPage(query, 1);
        setResults(res.items);
        setHasMore(res.hasMore);
        setPage(1);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  async function loadMore() {
    setLoading(true);
    try {
      const next = page + 1;
      const res = await searchCustomersPage(query, next);
      setResults((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
      setPage(next);
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(customer: CustomerSummary | null) {
    onSelect(customer);
    setOpen(false);
  }

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
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <User className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{selected.name}</span>
              {selected.sector && (
                <span className="shrink-0 text-xs text-muted-foreground">· {selected.sector}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Todos os clientes</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente…"
            className="h-7 border-0 p-0 text-sm shadow-none focus-visible:ring-0"
          />
          {loading && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        </div>

        <div className="max-h-60 overflow-y-auto">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Users className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn("flex-1", !selected && "font-medium")}>Todos os clientes</span>
            {!selected && <Check className="size-4 shrink-0" />}
          </button>

          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleSelect(c)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <Check
                className={cn("size-4 shrink-0", selected?.id === c.id ? "opacity-100" : "opacity-0")}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                {(c.sector || c.phone) && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {[c.sector, c.phone].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
            </button>
          ))}

          {!loading && results.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Nenhum cliente encontrado.
            </p>
          )}

          {hasMore && (
            <div className="border-t p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : "Carregar mais"}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
