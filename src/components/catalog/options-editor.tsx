"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_OPTIONS, type KeyedOption } from "@/lib/variant-options";

function newKey(): string {
  return `new:${crypto.randomUUID()}`;
}

export function blankOption(): KeyedOption {
  return { key: newKey(), id: null, name: "", values: [] };
}

function ValueAdder({ onAdd }: { onAdd: (name: string) => void }) {
  const [draft, setDraft] = useState("");

  function commit() {
    const name = draft.trim();
    if (!name) return;
    onAdd(name);
    setDraft("");
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="Novo valor"
        className="h-8 w-28"
        enterKeyHint="done"
      />
      <Button type="button" variant="ghost" size="icon" className="size-8" onClick={commit} aria-label="Adicionar valor">
        <Plus className="size-4" />
      </Button>
    </div>
  );
}

export function OptionsEditor({
  options,
  onChange,
}: {
  options: KeyedOption[];
  onChange: (next: KeyedOption[]) => void;
}) {
  function update(key: string, patch: (option: KeyedOption) => KeyedOption) {
    onChange(options.map((o) => (o.key === key ? patch(o) : o)));
  }

  return (
    <div className="space-y-3">
      {options.map((option, index) => (
        <div key={option.key} className="space-y-3 rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2">
            <Input
              value={option.name}
              onChange={(e) => update(option.key, (o) => ({ ...o, name: e.target.value }))}
              placeholder={index === 0 ? "Ex.: Tamanho" : "Ex.: Cor"}
              aria-label="Nome do eixo"
              className="h-9 font-medium"
            />
            <button
              type="button"
              onClick={() => onChange(options.filter((o) => o.key !== option.key))}
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
              aria-label={`Remover eixo ${option.name || index + 1}`}
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {option.values.map((value) => (
              <div key={value.key} className="flex items-center rounded-md border bg-background pr-1">
                <input
                  value={value.name}
                  onChange={(e) =>
                    update(option.key, (o) => ({
                      ...o,
                      values: o.values.map((v) => (v.key === value.key ? { ...v, name: e.target.value } : v)),
                    }))
                  }
                  aria-label={`Valor de ${option.name || "eixo"}`}
                  size={Math.max(value.name.length, 2)}
                  className="h-8 bg-transparent px-2 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    update(option.key, (o) => ({ ...o, values: o.values.filter((v) => v.key !== value.key) }))
                  }
                  className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  aria-label={`Remover ${value.name}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <ValueAdder
              onAdd={(name) =>
                update(option.key, (o) => ({ ...o, values: [...o.values, { key: newKey(), id: null, name }] }))
              }
            />
          </div>
        </div>
      ))}

      {options.length < MAX_OPTIONS && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...options, blankOption()])}>
          <Plus />
          {options.length === 0 ? "Adicionar variação" : "Adicionar outro eixo"}
        </Button>
      )}
    </div>
  );
}
