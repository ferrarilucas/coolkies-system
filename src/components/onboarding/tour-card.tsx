"use client";

import { useEffect, useRef, useState } from "react";
import type { CardComponentProps } from "nextstepjs";
import { useTourRunner } from "./runner-context";
import { TourCardBody } from "./tour-card-body";

const EDGE_MARGIN = 12;
const SETTLE_MS = 800;

export function TourCard({ arrow }: CardComponentProps) {
  const runner = useTourRunner();
  const step = runner.steps[runner.index];
  const frame = useRef<HTMLDivElement>(null);
  const shiftRef = useRef(0);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const element = frame.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const base = rect.left - shiftRef.current;
      const width = rect.width;
      const max = window.innerWidth - EDGE_MARGIN - width;
      const desired = Math.min(Math.max(base, EDGE_MARGIN), Math.max(max, EDGE_MARGIN));
      const next = Math.round(desired - base);
      if (next !== shiftRef.current) {
        shiftRef.current = next;
        setShift(next);
      }
    };
    const startedAt = performance.now();
    const tick = () => {
      measure();
      if (performance.now() - startedAt < SETTLE_MS) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [runner.index]);

  if (!step) return null;

  return (
    <div className="relative">
      <div
        ref={frame}
        style={{ transform: `translateX(${shift}px)` }}
        className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 text-card-foreground shadow-xl"
      >
        <TourCardBody
          step={step}
          position={runner.index + 1}
          total={runner.steps.length}
          onNext={runner.next}
          onSkipTo={runner.skipTo}
          onStop={runner.stop}
        />
      </div>
      <div className="text-card">{arrow}</div>
    </div>
  );
}
