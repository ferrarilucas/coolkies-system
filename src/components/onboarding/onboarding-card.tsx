"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DismissOnboardingDialog } from "./dismiss-dialog";
import { MissionsDialog } from "./missions-dialog";
import { useOnboarding } from "./onboarding-context";
import { SectorPromptCard } from "./sector-prompt-card";

export function OnboardingCard() {
  const onboarding = useOnboarding();
  const [listOpen, setListOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!onboarding.missionsVisible) return <SectorPromptCard />;

  const next = onboarding.nextMission;
  if (!next) return null;

  const { done, total } = onboarding.counts;
  const position = onboarding.missions.findIndex((mission) => mission.id === next.id) + 1;
  const paused = onboarding.pausedMissionId === next.id;

  return (
    <section
      data-tour="onboarding-card"
      className="mb-5 rounded-2xl border border-primary/30 bg-card p-4 shadow-sm duration-500 animate-in fade-in slide-in-from-top-2"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Primeiros passos</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            {done}/{total}
          </span>
        </div>
        <button
          type="button"
          aria-label="Esconder primeiros passos"
          onClick={() => setConfirmOpen(true)}
          className="-m-1 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
      <div key={next.id} className="mt-4 flex items-center gap-3 duration-500 animate-in fade-in slide-in-from-right-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{onboarding.text(next.title)}</p>
          <p className="text-xs text-muted-foreground">{onboarding.text(next.description)}</p>
        </div>
        <Button size="sm" onClick={() => onboarding.startMission(next.id)}>
          {paused ? "Continuar" : "Fazer"}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setListOpen(true)}
        className="mt-3 text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        Ver todas as {total} missões
      </button>
      <MissionsDialog open={listOpen} onOpenChange={setListOpen} />
      <DismissOnboardingDialog open={confirmOpen} onOpenChange={setConfirmOpen} />
    </section>
  );
}
