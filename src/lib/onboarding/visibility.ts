import type { MemberRole } from "@prisma/client";
import { modelOf, type SectorKey } from "./sectors";
import { MISSIONS, MISSION_IDS, MISSION_ORDER, type MissionDef, type MissionId, type OnboardingProgress } from "./missions";

export type OnboardingState = {
  workspaceId: string;
  sector: SectorKey | null;
  dismissed: boolean;
  appTourDone: boolean;
  eligible: boolean;
  progress: OnboardingProgress | null;
};

export function canSeeMissions(role: MemberRole, canWrite: boolean): boolean {
  return canWrite && (role === "OWNER" || role === "ADMIN");
}

export function missionsOf(state: OnboardingState): MissionDef[] {
  return state.sector ? MISSION_ORDER[modelOf(state.sector)].map((id) => MISSIONS[id]) : [];
}

export function pendingMissions(state: OnboardingState): MissionDef[] {
  const progress = state.progress;
  if (!progress) return [];
  return missionsOf(state).filter((mission) => !progress[mission.id]);
}

export function nextMission(state: OnboardingState): MissionDef | null {
  return pendingMissions(state)[0] ?? null;
}

export function missionCounts(state: OnboardingState): { done: number; total: number } {
  const all = missionsOf(state);
  const progress = state.progress;
  return { done: progress ? all.filter((mission) => progress[mission.id]).length : 0, total: all.length };
}

export function canPreviewMissions(state: OnboardingState): boolean {
  return state.eligible && state.sector !== null && !state.dismissed && state.progress !== null && pendingMissions(state).length > 0;
}

export function shouldShowMissions(state: OnboardingState, appTourRunning: boolean): boolean {
  return canPreviewMissions(state) && (state.appTourDone || appTourRunning);
}

export function shouldShowSectorPrompt(state: OnboardingState): boolean {
  return state.eligible && state.sector === null && !state.dismissed && state.appTourDone;
}

export function shouldShowAppTour(state: OnboardingState): boolean {
  return !state.appTourDone;
}

export function newlyCompleted(before: OnboardingProgress | null, after: OnboardingProgress | null): MissionId[] {
  if (!before || !after) return [];
  return MISSION_IDS.filter((id) => !before[id] && after[id]);
}

export function allMissionsDone(state: OnboardingState): boolean {
  return state.progress !== null && missionsOf(state).length > 0 && pendingMissions(state).length === 0;
}
