"use client";

import { createContext, useContext } from "react";
import type { BuiltStep } from "@/lib/onboarding/build-tour";

export type RunnerValue = {
  steps: BuiltStep[];
  index: number;
  next: () => void;
  skipTo: (id: string) => void;
  stop: () => void;
};

export const RunnerContext = createContext<RunnerValue | null>(null);

export function useTourRunner(): RunnerValue {
  const value = useContext(RunnerContext);
  if (!value) throw new Error("useTourRunner precisa do TourRunner");
  return value;
}
