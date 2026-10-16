"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NextStep, NextStepProvider, useNextStep, type Tour } from "nextstepjs";
import { APP_TOUR } from "@/lib/onboarding/app-tour";
import { buildSteps, fallbackIndexBefore, stepIndexById, usesSpotlight, type Viewport } from "@/lib/onboarding/build-tour";
import { VariationsGuideDialog } from "@/components/catalog/variations-guide";
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
const UNTIL_STABLE_MS = 1000;
const UNTIL_POLL_MS = 100;
const DIALOG_WATCH_MS = 250;
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
  const { startNextStep, setCurrentStep, closeNextStep, currentTour, isNextStepVisible } = useNextStep();
  const mission = run.kind === "mission" ? MISSIONS[run.missionId] : null;
  const [index, setIndex] = useState(-1);
  const [guideOpen, setGuideOpen] = useState(mission?.intro === "variations-guide");
  const token = useRef(0);
  const polling = useRef(false);
  const currentId = useRef<string | null>(null);
  const previousSteps = useRef<typeof steps | null>(null);
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
          disableInteraction: run.kind === "app" && step.def.advance.on === "next",
          selectorRetryAttempts: 5,
          scrollOffset: 96,
        })),
      },
    ],
    [steps, run.kind],
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
      currentId.current = steps[next].def.id;
      setIndex(next);
    },
    [steps, leave, run.kind],
  );

  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  const confirmFinal = useCallback(async () => {
    if (run.kind !== "mission" || polling.current) return;
    polling.current = true;
    const current = token.current;
    try {
      for (let attempt = 0; attempt < FINAL_POLLS; attempt += 1) {
        await sleep(1000);
        if (current !== token.current) return;
        const progress = await onboardingRef.current.refresh();
        if (progress?.[run.missionId]) return;
      }
      if (current === token.current) onboardingRef.current.pauseRun();
    } catch {
      return;
    } finally {
      polling.current = false;
    }
  }, [run]);

  useEffect(() => {
    if (!guideOpen) void goToRef.current(0);
  }, [guideOpen]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        window.dispatchEvent(new Event("resize"));
      });
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
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
      if (currentTour !== TOUR_NAME || !isNextStepVisible) startNextStep(TOUR_NAME);
      setCurrentStep(index);
    } else if (currentTour === TOUR_NAME) {
      closeNextStep();
    }
  }, [index, steps, currentTour, isNextStepVisible, startNextStep, setCurrentStep, closeNextStep]);

  useEffect(() => {
    if (previousSteps.current === steps) return;
    const hadSteps = previousSteps.current !== null;
    previousSteps.current = steps;
    if (!hadSteps || index < 0) return;
    const remapped = currentId.current ? stepIndexById(steps, currentId.current) : -1;
    closeNextStep();
    void goToRef.current(remapped >= 0 ? remapped : Math.min(index, steps.length));
  }, [steps, index, closeNextStep]);

  useEffect(() => {
    if (index < 0 || index >= steps.length) return;
    const step = steps[index];

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

    if (advance.on === "await") {
      const abort = new AbortController();
      void waitFor(() => document.querySelector(advance.until) !== null, {
        timeoutMs: Number.POSITIVE_INFINITY,
        signal: abort.signal,
      }).then((ok) => {
        if (ok) void goTo(index + 1);
      });
      cleanups.push(() => abort.abort());
    }

    if (advance.on === "until") {
      const abort = new AbortController();
      void (async () => {
        let since: number | null = null;
        while (!abort.signal.aborted) {
          if (document.querySelector(advance.until) !== null) {
            since ??= Date.now();
            if (Date.now() - since >= UNTIL_STABLE_MS) {
              void goTo(index + 1);
              return;
            }
          } else {
            since = null;
          }
          await sleep(UNTIL_POLL_MS);
        }
      })();
      cleanups.push(() => abort.abort());
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [index, steps, goTo, confirmFinal]);

  useEffect(() => {
    if (index < 0 || index >= steps.length) return;
    const viewportId = steps[index].def.viewport;
    if (!viewportId) return;
    let seen = false;
    const timer = setInterval(() => {
      if (document.getElementById(viewportId)) {
        seen = true;
        return;
      }
      if (!seen) return;
      clearInterval(timer);
      const fallback = fallbackIndexBefore(steps, index);
      if (fallback >= 0) void goToRef.current(fallback);
    }, DIALOG_WATCH_MS);
    return () => clearInterval(timer);
  }, [index, steps]);

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
      {current && !usesSpotlight(current) ? <InlineHint key={current.def.id} step={current} /> : null}
      {mission?.intro === "variations-guide" ? (
        <VariationsGuideDialog open={guideOpen} onOpenChange={setGuideOpen} example={examples} />
      ) : null}
    </RunnerContext.Provider>
  );
}
