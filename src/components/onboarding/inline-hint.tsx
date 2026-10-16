"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { BuiltStep } from "@/lib/onboarding/build-tour";
import { cn } from "@/lib/utils";
import { useTourRunner } from "./runner-context";
import { TourCardBody } from "./tour-card-body";

export function InlineHint({ step }: { step: BuiltStep }) {
  const runner = useTourRunner();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const viewport = step.def.viewport;

  useEffect(() => {
    if (!viewport) {
      setHost(document.body);
      return;
    }
    const resolve = () => {
      const element = document.getElementById(viewport);
      setHost((previous) => (previous === element ? previous : element));
    };
    resolve();
    const timer = setInterval(resolve, 250);
    return () => clearInterval(timer);
  }, [viewport]);

  if (!host) return null;

  return createPortal(
    <div
      key={step.def.id}
      className={cn(
        "z-[70] rounded-2xl border bg-card p-4 text-card-foreground shadow-xl duration-300 animate-in fade-in slide-in-from-bottom-4",
        viewport
          ? "sticky bottom-0 mt-2"
          : "fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] mx-auto max-w-sm md:inset-x-auto md:bottom-6 md:right-6 md:w-80",
      )}
    >
      <TourCardBody
        step={step}
        position={runner.index + 1}
        total={runner.steps.length}
        onNext={runner.next}
        onSkipTo={runner.skipTo}
        onStop={runner.stop}
      />
    </div>,
    host,
  );
}
