"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SectorKey } from "@/lib/onboarding/sectors";
import { shouldShowSectorPrompt } from "@/lib/onboarding/visibility";
import { DismissOnboardingDialog } from "./dismiss-dialog";
import { useOnboarding } from "./onboarding-context";
import { SectorPicker } from "./sector-picker";

export function SectorPromptCard() {
  const onboarding = useOnboarding();
  const [sector, setSector] = useState<SectorKey | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!shouldShowSectorPrompt(onboarding.state)) return null;

  return (
    <section className="mb-5 space-y-4 rounded-2xl border border-primary/30 bg-card p-4 shadow-sm duration-500 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Conte qual é o seu ramo</h2>
          <p className="text-xs text-muted-foreground">
            Assim mostramos os primeiros passos certos e o que ainda dá para aproveitar no app.
          </p>
        </div>
        <button
          type="button"
          aria-label="Esconder"
          onClick={() => setConfirmOpen(true)}
          className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
      <SectorPicker value={sector} onChange={setSector} disabled={pending} className="sm:grid-cols-3 lg:grid-cols-5" />
      <Button
        className="w-full sm:w-auto"
        disabled={!sector || pending}
        onClick={() => {
          if (!sector) return;
          startTransition(async () => {
            await onboarding.chooseSector(sector);
          });
        }}
      >
        {pending ? "Salvando..." : "Ver meus primeiros passos"}
      </Button>
      <DismissOnboardingDialog open={confirmOpen} onOpenChange={setConfirmOpen} />
    </section>
  );
}
