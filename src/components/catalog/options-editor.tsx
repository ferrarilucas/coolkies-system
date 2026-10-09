"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_OPTIONS, type KeyedOption } from "@/lib/variant-options";

function newKey(): string {
  return `new:${crypto.randomUUID()}`;
}

export function blankOption(): KeyedOption {
  return { key: newKey(), id: null, name: "", values: [] };
}

function ValueAdder({ onAdd }: { onAdd: (names: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function commit() {
    const names = draft
      .split(/[,;\n]/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    onAdd(names);
    setDraft("");
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder="Adicionar opção"
        aria-label="Adicionar opção"
        className="h-8 w-40"
        enterKeyHint="done"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={commit}
        aria-label="Adicionar opção"
      >
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
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor={`option-name-${option.key}`} className="text-xs text-muted-foreground">
                Tipo de variação
              </Label>
              <Input
                id={`option-name-${option.key}`}
                value={option.name}
                onChange={(e) => update(option.key, (o) => ({ ...o, name: e.target.value }))}
                placeholder={index === 0 ? "Ex.: Sabor" : "Ex.: Tamanho"}
                className="h-9 font-medium"
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(options.filter((o) => o.key !== option.key))}
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
              aria-label={`Remover ${option.name || "tipo de variação"}`}
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Opções <span className="text-muted-foreground/70">· separe por vírgula ou aperte Enter</span>
            </p>
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
                    aria-label={`Opção de ${option.name || "variação"}`}
                    size={Math.max(value.name.length + 2, 3)}
                    className="h-8 bg-transparent px-2 text-sm outline-none [field-sizing:content]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      update(option.key, (o) => ({
                        ...o,
                        values: o.values.filter((v) => v.key !== value.key),
                      }))
                    }
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                    aria-label={`Remover ${value.name}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <ValueAdder
                onAdd={(names) =>
                  update(option.key, (o) => ({
                    ...o,
                    values: [
                      ...o.values,
                      ...names.map((name) => ({
                        key: newKey(),
                        id: null,
                        name,
                      })),
                    ],
                  }))
                }
              />
            </div>
          </div>
        </div>
      ))}

      {options.length < MAX_OPTIONS && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...options, blankOption()])}>
          <Plus />
          {options.length === 0 ? "Adicionar variação" : "Adicionar outro tipo de variação"}
        </Button>
      )}
    </div>
  );
}
