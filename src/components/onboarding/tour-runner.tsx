"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NextStep, NextStepProvider, useNextStep, type Tour } from "nextstepjs";
import { APP_TOUR } from "@/lib/onboarding/app-tour";
import { buildSteps, stepIndexById, usesSpotlight, type Viewport } from "@/lib/onboarding/build-tour";
import { MISSIONS, isRouteOfMission } from "@/lib/onboarding/missions";
import { waitFor } from "@/lib/onboarding/wait-for";
import { findTarget } from "./find-target";
import { InlineHint } from "./inline-hint";
import { useOnboarding, type TourRun } from "./onboarding-context";
import { RunnerContext, type RunnerValue } from "./runner-context";
import { TourCard } from "./tour-card";

const TOUR_NAME = "onboarding";
const TARGET_TIMEOUT_MS = 8000;
const OPTIONAL_TIMEOUT_MS = 1500;
const FINAL_POLLS = 10;
const DESKTOP_QUERY = "(min-width: 768px)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() =>
    window.matchMedia(DESKTOP_QUERY).matches ? "desktop" : "mobile",
  );

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setViewport(query.matches ? "desktop" : "mobile");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return viewport;
}

export function TourRunner({ run }: { run: TourRun }) {
  return (
    <NextStepProvider>
      <Controller run={run} />
    </NextStepProvider>
  );
}

function Controller({ run }: { run: TourRun }) {
  const onboarding = useOnboarding();
  const onboardingRef = useRef(onboarding);
  onboardingRef.current = onboarding;
  const viewport = useViewport();
  const pathname = usePathname();
  const { startNextStep, setCurrentStep, closeNextStep } = useNextStep();
  const mission = run.kind === "mission" ? MISSIONS[run.missionId] : null;
  const [index, setIndex] = useState(-1);
  const token = useRef(0);
  const spotlightOn = useRef(false);
  const arrived = useRef(false);
  const { model, examples, missionsPreviewable } = onboarding;

  const steps = useMemo(
    () =>
      buildSteps(mission ? mission.steps : APP_TOUR, {
        model,
        viewport,
        examples,
        missionsVisible: missionsPreviewable,
      }),
    [mission, model, viewport, examples, missionsPreviewable],
  );

  const tours = useMemo<Tour[]>(
    () => [
      {
        tour: TOUR_NAME,
        steps: steps.map((step) => ({
          title: step.title,
          content: step.content,
          selector: step.selector,
          side: step.side,
          pointerPadding: 8,
          pointerRadius: 14,
          blockKeyboardControl: true,
          selectorRetryAttempts: 5,
          scrollOffset: 96,
        })),
      },
    ],
    [steps],
  );

  const leave = useCallback(() => {
    if (run.kind === "app") void onboardingRef.current.finishAppTour();
    else onboardingRef.current.pauseRun();
  }, [run.kind]);

  const goTo = useCallback(
    async (target: number) => {
      token.current += 1;
      const current = token.current;
      let next = target;
      while (next < steps.length) {
        const step = steps[next];
        const found = await waitFor(() => findTarget(step.selector) !== null, {
          timeoutMs: step.def.optional ? OPTIONAL_TIMEOUT_MS : TARGET_TIMEOUT_MS,
        });
        if (current !== token.current) return;
        if (found) break;
        if (!step.def.optional) {
          leave();
          return;
        }
        next += 1;
      }
      if (next >= steps.length) {
        if (run.kind === "app") void onboardingRef.current.finishAppTour();
        else onboardingRef.current.stopRun();
        return;
      }
      setIndex(next);
    },
    [steps, leave, run.kind],
  );

  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  const confirmFinal = useCallback(async () => {
    if (run.kind !== "mission") return;
    const current = token.current;
    for (let attempt = 0; attempt < FINAL_POLLS; attempt += 1) {
      await sleep(1000);
      if (current !== token.current) return;
      const progress = await onboardingRef.current.refresh();
      if (progress?.[run.missionId]) return;
    }
  }, [run]);

  useEffect(() => {
    void goToRef.current(0);
  }, []);

  useEffect(
    () => () => {
      token.current += 1;
      closeNextStep();
    },
    [closeNextStep],
  );

  useEffect(() => {
    if (!mission) {
      if (pathname !== "/dashboard") leave();
      return;
    }
    if (isRouteOfMission(pathname, mission)) {
      arrived.current = true;
      return;
    }
    if (arrived.current) leave();
  }, [pathname, mission, leave]);

  useEffect(() => {
    if (index < 0 || index >= steps.length) return;
    const step = steps[index];

    if (usesSpotlight(step)) {
      if (!spotlightOn.current) {
        startNextStep(TOUR_NAME);
        spotlightOn.current = true;
      }
      setCurrentStep(index);
    } else if (spotlightOn.current) {
      closeNextStep();
      spotlightOn.current = false;
    }

    const element = findTarget(step.selector);
    element?.setAttribute("data-tour-active", "");
    const cleanups: Array<() => void> = [() => element?.removeAttribute("data-tour-active")];
    const advance = step.def.advance;

    if (advance.on === "click" && element) {
      const onClick = () => {
        if (advance.final) void confirmFinal();
        else void goTo(index + 1);
      };
      element.addEventListener("click", onClick);
      cleanups.push(() => element.removeEventListener("click", onClick));
    }

    if (advance.on === "until" || advance.on === "await") {
      const abort = new AbortController();
      void waitFor(() => document.querySelector(advance.until) !== null, {
        timeoutMs: Number.POSITIVE_INFINITY,
        signal: abort.signal,
      }).then((ok) => {
        if (ok) void goTo(index + 1);
      });
      cleanups.push(() => abort.abort());
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [index, steps, startNextStep, setCurrentStep, closeNextStep, goTo, confirmFinal]);

  const runner = useMemo<RunnerValue>(
    () => ({
      steps,
      index,
      next: () => void goTo(index + 1),
      skipTo: (id: string) => {
        const target = stepIndexById(steps, id);
        if (target >= 0) void goTo(target);
      },
      stop: leave,
    }),
    [steps, index, goTo, leave],
  );

  const current = index >= 0 ? steps[index] : undefined;

  return (
    <RunnerContext.Provider value={runner}>
      <NextStep
        steps={tours}
        cardComponent={TourCard}
        shadowRgb="20, 18, 15"
        shadowOpacity="0.62"
        cardTransition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
        scrollToTop={false}
        disableConsoleLogs
      >
        <></>
      </NextStep>
      {current && !usesSpotlight(current) ? <InlineHint step={current} /> : null}
    </RunnerContext.Provider>
  );
}
