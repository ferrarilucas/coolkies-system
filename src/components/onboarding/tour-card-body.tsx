"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BuiltStep } from "@/lib/onboarding/build-tour";

const WAITING_LABEL = {
  click: "Toque no destaque para continuar",
  until: "Preencha o campo destacado para continuar",
  await: "Escolha no campo destacado para continuar",
} as const;

export function TourCardBody({
  step,
  position,
  total,
  onNext,
  onSkipTo,
  onStop,
}: {
  step: BuiltStep;
  position: number;
  total: number;
  onNext: () => void;
  onSkipTo: (id: string) => void;
  onStop: () => void;
}) {
  const advance = step.def.advance;
  const skip = step.def.skip;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Passo {position} de {total}
          </p>
          <p className="text-base font-semibold leading-snug">{step.title}</p>
        </div>
        <button
          type="button"
          onClick={onStop}
          aria-label="Sair do guia"
          className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{step.content}</p>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${(position / total) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {skip ? (
          <Button variant="ghost" size="sm" onClick={() => onSkipTo(skip.to)}>
            {skip.label}
          </Button>
        ) : null}
        {advance.on === "next" ? (
          <Button size="sm" onClick={onNext}>
            {position === total ? "Concluir" : "Próximo"}
          </Button>
        ) : (
          <p className="text-xs font-medium text-primary">{WAITING_LABEL[advance.on]}</p>
        )}
      </div>
    </div>
  );
}
