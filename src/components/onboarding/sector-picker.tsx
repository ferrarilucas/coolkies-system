"use client";

import { SECTORS, type SectorKey } from "@/lib/onboarding/sectors";
import { timing } from "@/components/pwa/guide-parts";
import { cn } from "@/lib/utils";

export function SectorPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: SectorKey | null;
  onChange: (key: SectorKey) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Ramo do negócio" className={cn("grid grid-cols-2 gap-2", className)}>
      {SECTORS.map(({ key, label, icon: Icon }, index) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(key)}
            style={timing(index * 0.04)}
            className={cn(
              "pwa-pop flex min-h-20 flex-col items-start justify-between gap-2 rounded-xl border bg-card p-3 text-left text-sm transition-colors disabled:opacity-60",
              selected ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "hover:bg-muted",
            )}
          >
            <Icon className={cn("size-5 transition-colors", selected ? "text-primary" : "text-muted-foreground")} />
            <span className="font-medium leading-tight">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
