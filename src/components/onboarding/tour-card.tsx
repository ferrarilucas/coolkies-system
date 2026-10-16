"use client";

import { useEffect, useRef, useState } from "react";
import type { CardComponentProps } from "nextstepjs";
import { useTourRunner } from "./runner-context";
import { TourCardBody } from "./tour-card-body";

const EDGE_MARGIN = 12;

export function TourCard({ arrow }: CardComponentProps) {
  const runner = useTourRunner();
  const step = runner.steps[runner.index];
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const shiftRef = useRef(0);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const element = frame.current;
      const parent = container.current;
      if (element && parent) {
        const left = parent.getBoundingClientRect().left;
        const width = element.offsetWidth;
        const max = Math.max(window.innerWidth - EDGE_MARGIN - width, EDGE_MARGIN);
        const desired = Math.min(Math.max(left, EDGE_MARGIN), max);
        const next = Math.round(desired - left);
        if (next !== shiftRef.current) {
          shiftRef.current = next;
          setShift(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!step) return null;

  return (
    <div ref={container} className="relative">
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
