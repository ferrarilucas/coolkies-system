"use client";

import { createContext, useContext } from "react";
import type { MissionDef, MissionId, OnboardingProgress } from "@/lib/onboarding/missions";
import type { Model, SectorExamples, SectorKey } from "@/lib/onboarding/sectors";
import type { OnboardingState } from "@/lib/onboarding/visibility";

export type TourRun = { kind: "app" } | { kind: "mission"; missionId: MissionId };

export type Celebrating = { kind: "mission"; missionId: MissionId } | { kind: "all" };

export type OnboardingValue = {
  state: OnboardingState;
  model: Model | null;
  examples: SectorExamples;
  missions: MissionDef[];
  nextMission: MissionDef | null;
  counts: { done: number; total: number };
  missionsPreviewable: boolean;
  missionsVisible: boolean;
  run: TourRun | null;
  pausedMissionId: MissionId | null;
  celebrating: Celebrating | null;
  text: (input: string) => string;
  startMission: (missionId: MissionId) => void;
  pauseRun: () => void;
  stopRun: () => void;
  finishAppTour: () => Promise<void>;
  refresh: () => Promise<OnboardingProgress | null>;
  chooseSector: (sector: SectorKey) => Promise<boolean>;
  dismiss: () => Promise<void>;
  resume: () => Promise<void>;
  restartTour: () => Promise<void>;
  clearCelebration: () => void;
};

export const OnboardingContext = createContext<OnboardingValue | null>(null);

export function useOnboarding(): OnboardingValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error("useOnboarding precisa do OnboardingProvider");
  return value;
}

export function useOptionalOnboarding(): OnboardingValue | null {
  return useContext(OnboardingContext);
}
