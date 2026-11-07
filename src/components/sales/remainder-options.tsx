"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, ListPlus, Split } from "lucide-react";
import type { ForecastPreset } from "@/lib/business-days";
import { formatBRL } from "@/lib/money";
import { canSpread, planRemainder, type RemainderChoice, type SaleRow } from "@/lib/partial-payment";
import { cn } from "@/lib/utils";

type Mode = RemainderChoice["mode"];

export type RemainderDraft = { mode: Mode; dueDate: string };

export function toRemainderChoice(draft: RemainderDraft): RemainderChoice {
  return draft.mode === "NEW_DATE" ? { mode: "NEW_DATE", dueDate: draft.dueDate } : { mode: draft.mode };
}

function formatDay(date: Date | null): string {
  return date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "sem vencimento";
}

function spreadPreview(rows: SaleRow[], updates: { id: string; amountCents: number }[], installmentCount: number): string {
  const deltas = updates.map((update) => {
    const current = rows.find((row) => row.id === update.id);
    return { number: current?.number ?? 0, cents: update.amountCents - (current?.amountCents ?? 0) };
  });
  if (deltas.length === 1) return `+${formatBRL(deltas[0].cents)} na parcela ${deltas[0].number}/${installmentCount}`;
  const first = deltas[0].cents;
  const last = deltas[deltas.length - 1].cents;
  const base = `+${formatBRL(first)} em cada uma das ${deltas.length} parcelas`;
  return first === last ? base : `${base} (${formatBRL(last)} na última)`;
}

export function RemainderOptions({
  rows,
  partialNumber,
  remainderCents,
  preset,
  now,
  excludeIds,
  installmentCount,
  value,
  onChange,
  disabled,
}: {
  rows: SaleRow[];
  partialNumber: number;
  remainderCents: number;
  preset: ForecastPreset | null;
  now: Date;
  excludeIds: string[];
  installmentCount: number;
  value: RemainderDraft;
  onChange: (draft: RemainderDraft) => void;
  disabled?: boolean;
}) {
  const plan = (choice: RemainderChoice) =>
    planRemainder(rows, partialNumber, remainderCents, choice, preset, now, excludeIds);

  const newDate = plan({ mode: "NEW_DATE", dueDate: value.dueDate });
  const spreadable = canSpread(rows, partialNumber, excludeIds);
  const spread = spreadable ? plan({ mode: "SPREAD" }) : null;
  const append = plan({ mode: "APPEND" });

  const options: { mode: Mode; title: string; preview: string; icon: typeof CalendarClock }[] = [
    {
      mode: "NEW_DATE",
      title: "Cobrar em outra data",
      preview: newDate.ok
        ? `Vira a parcela ${partialNumber + 1}/${installmentCount + 1} · ${formatDay(newDate.plan.creates[0]?.dueDate ?? null)}`
        : newDate.error,
      icon: CalendarClock,
    },
    ...(spread
      ? [
          {
            mode: "SPREAD" as const,
            title: "Diluir nas próximas parcelas",
            preview: spread.ok ? spreadPreview(rows, spread.plan.updates, installmentCount) : spread.error,
            icon: Split,
          },
        ]
      : []),
    {
      mode: "APPEND",
      title: "Criar parcela nova no fim",
      preview: append.ok
        ? `Parcela ${installmentCount + 1}/${installmentCount + 1} · ${formatDay(append.plan.creates[0]?.dueDate ?? null)}`
        : append.error,
      icon: ListPlus,
    },
  ];

  return (
    <div role="radiogroup" aria-label="O que fazer com o restante" className="space-y-2">
      {options.map((option) => {
        const checked = value.mode === option.mode;
        const Icon = option.icon;
        return (
          <div
            key={option.mode}
            className={cn(
              "rounded-lg border transition-colors",
              checked ? "border-primary bg-primary/5" : "hover:bg-muted",
            )}
          >
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => onChange({ ...value, mode: option.mode })}
              className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left disabled:opacity-50"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-primary" : "border-muted-foreground/40",
                )}
              >
                {checked && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">{option.preview}</span>
              </span>
            </button>
            {option.mode === "NEW_DATE" && checked && (
              <div className="px-3 pb-3 pl-11">
                <label htmlFor="remainder-due-date" className="sr-only">
                  Data da nova cobrança
                </label>
                <input
                  id="remainder-due-date"
                  type="date"
                  required
                  disabled={disabled}
                  value={value.dueDate}
                  onChange={(e) => onChange({ ...value, dueDate: e.target.value })}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
