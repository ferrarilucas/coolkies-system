"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { MISSIONS, type MissionId, type OnboardingProgress } from "@/lib/onboarding/missions";
import { getSector, modelOf, type SectorKey } from "@/lib/onboarding/sectors";
import { fillText } from "@/lib/onboarding/text";
import {
  allMissionsDone,
  canPreviewMissions,
  missionCounts,
  missionsOf,
  newlyCompleted,
  nextMission,
  shouldShowMissions,
  type OnboardingState,
} from "@/lib/onboarding/visibility";
import {
  chooseWorkspaceSector,
  dismissOnboarding,
  finishAppTour as finishAppTourAction,
  refreshOnboardingProgress,
  restartAppTour as restartAppTourAction,
  resumeOnboarding,
} from "@/server/actions/onboarding";
import { OnboardingContext, type Celebrating, type OnboardingValue, type TourRun } from "./onboarding-context";

const FALLBACK_EXAMPLES = getSector("outro").examples;

export function OnboardingProvider({ initial, children }: { initial: OnboardingState; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(initial);
  const [run, setRun] = useState<TourRun | null>(null);
  const [pausedMissionId, setPausedMissionId] = useState<MissionId | null>(null);
  const [celebrating, setCelebrating] = useState<Celebrating | null>(null);
  const stateRef = useRef(initial);
  const runRef = useRef<TourRun | null>(null);
  const latestInitial = useRef(initial);
  latestInitial.current = initial;
  runRef.current = run;

  const commit = useCallback((next: OnboardingState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const applyProgress = useCallback(
    (progress: OnboardingProgress | null) => {
      const before = stateRef.current;
      const after = { ...before, progress };
      commit(after);
      const relevant = new Set(missionsOf(after).map((mission) => mission.id));
      const fresh = newlyCompleted(before.progress, progress).filter((id) => relevant.has(id));
      if (fresh.length === 0) return;
      const current = runRef.current;
      if (current?.kind === "mission" && fresh.includes(current.missionId)) setRun(null);
      setPausedMissionId((paused) => (paused && fresh.includes(paused) ? null : paused));
      setCelebrating(allMissionsDone(after) ? { kind: "all" } : { kind: "mission", missionId: fresh[0] });
    },
    [commit],
  );

  const initialKey = JSON.stringify(initial);
  useEffect(() => {
    const incoming = latestInitial.current;
    stateRef.current = { ...incoming, progress: stateRef.current.progress };
    applyProgress(incoming.progress);
  }, [initialKey, applyProgress]);

  useEffect(() => {
    if (!state.appTourDone && run === null && pathname === "/dashboard") setRun({ kind: "app" });
  }, [state.appTourDone, run, pathname]);

  const tracking = state.eligible && state.sector !== null && !state.dismissed;

  const refresh = useCallback(async () => {
    const progress = await refreshOnboardingProgress();
    applyProgress(progress);
    return progress;
  }, [applyProgress]);

  useEffect(() => {
    if (tracking) void refresh().catch(() => undefined);
  }, [pathname, tracking, refresh]);

  const finishAppTour = useCallback(async () => {
    commit({ ...stateRef.current, appTourDone: true });
    setRun((current) => (current?.kind === "app" ? null : current));
    const result = await finishAppTourAction();
    if (!result.ok) toast.error(result.error ?? "Não foi possível salvar o tour.");
  }, [commit]);

  const startMission = useCallback(
    (missionId: MissionId) => {
      setPausedMissionId(null);
      setRun({ kind: "mission", missionId });
      const route = MISSIONS[missionId].startRoute;
      if (pathname !== route) router.push(route);
    },
    [pathname, router],
  );

  const pauseRun = useCallback(() => {
    const current = runRef.current;
    if (current?.kind === "mission") setPausedMissionId(current.missionId);
    setRun(null);
  }, []);

  const stopRun = useCallback(() => setRun(null), []);

  const chooseSector = useCallback(
    async (sector: SectorKey) => {
      const result = await chooseWorkspaceSector(sector);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível salvar o ramo.");
        return false;
      }
      router.refresh();
      return true;
    },
    [router],
  );

  const dismiss = useCallback(async () => {
    commit({ ...stateRef.current, dismissed: true });
    setRun((current) => (current?.kind === "mission" ? null : current));
    const result = await dismissOnboarding();
    if (!result.ok) toast.error(result.error ?? "Não foi possível esconder os primeiros passos.");
  }, [commit]);

  const resume = useCallback(async () => {
    const result = await resumeOnboarding();
    if (!result.ok) {
      toast.error(result.error ?? "Não foi possível retomar os primeiros passos.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }, [router]);

  const restartTour = useCallback(async () => {
    const result = await restartAppTourAction();
    if (!result.ok) {
      toast.error(result.error ?? "Não foi possível reiniciar o tour.");
      return;
    }
    commit({ ...stateRef.current, appTourDone: false });
    router.push("/dashboard");
    router.refresh();
  }, [commit, router]);

  const clearCelebration = useCallback(() => setCelebrating(null), []);

  const value = useMemo<OnboardingValue>(() => {
    const examples = state.sector ? getSector(state.sector).examples : FALLBACK_EXAMPLES;
    return {
      state,
      model: state.sector ? modelOf(state.sector) : null,
      examples,
      missions: missionsOf(state),
      nextMission: nextMission(state),
      counts: missionCounts(state),
      missionsPreviewable: canPreviewMissions(state),
      missionsVisible: shouldShowMissions(state, run?.kind === "app"),
      run,
      pausedMissionId,
      celebrating,
      text: (input: string) => fillText(input, examples),
      startMission,
      pauseRun,
      stopRun,
      finishAppTour,
      refresh,
      chooseSector,
      dismiss,
      resume,
      restartTour,
      clearCelebration,
    };
  }, [
    state,
    run,
    pausedMissionId,
    celebrating,
    startMission,
    pauseRun,
    stopRun,
    finishAppTour,
    refresh,
    chooseSector,
    dismiss,
    resume,
    restartTour,
    clearCelebration,
  ]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
