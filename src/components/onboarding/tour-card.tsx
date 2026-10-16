"use client";

import type { CardComponentProps } from "nextstepjs";
import { useTourRunner } from "./runner-context";
import { TourCardBody } from "./tour-card-body";

export function TourCard({ arrow }: CardComponentProps) {
  const runner = useTourRunner();
  const step = runner.steps[runner.index];
  if (!step) return null;

  return (
    <div className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 text-card-foreground shadow-xl">
      <TourCardBody
        step={step}
        position={runner.index + 1}
        total={runner.steps.length}
        onNext={runner.next}
        onSkipTo={runner.skipTo}
        onStop={runner.stop}
      />
      <div className="text-card">{arrow}</div>
    </div>
  );
}
