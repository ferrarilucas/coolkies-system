"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SalesSearch({ initialValue, tab }: { initialValue: string; tab: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);

  function navigate(q: string) {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    if (q) params.set("q", q);
    const qs = params.toString();
    router.push(`/sales${qs ? `?${qs}` : ""}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    navigate(value.trim());
  }

  function clear() {
    setValue("");
    navigate("");
  }

  return (
    <form onSubmit={handleSubmit} className="relative mb-4">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Buscar por cliente, produto ou observação…"
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Limpar busca"
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      )}
    </form>
  );
}
