"use client";

import { useEffect, type CSSProperties } from "react";
import { Check, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MISSIONS } from "@/lib/onboarding/missions";
import { useOnboarding } from "./onboarding-context";

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--warning))", "hsl(var(--success))"];
const PIECE_COUNT = 28;
const PIECES = Array.from({ length: PIECE_COUNT }, (_, i) => {
  const angle = (i / PIECE_COUNT) * Math.PI * 2;
  const distance = 120 + (i % 5) * 28;
  return {
    x: Math.round(Math.cos(angle) * distance),
    y: Math.round(Math.sin(angle) * distance - 40),
    rotation: (i * 47) % 360,
    delay: (i % 7) * 0.03,
    color: COLORS[i % COLORS.length],
  };
});

export function Celebration() {
  const onboarding = useOnboarding();
  const { celebrating, clearCelebration } = onboarding;

  useEffect(() => {
    if (celebrating?.kind !== "mission") return;
    const timer = setTimeout(clearCelebration, 2600);
    return () => clearTimeout(timer);
  }, [celebrating, clearCelebration]);

  if (!celebrating) return null;

  const all = celebrating.kind === "all";
  const title = all ? "Tudo pronto!" : "Missão concluída!";
  const subtitle = all
    ? "Seu negócio está montado no app. Agora é só vender."
    : onboarding.text(MISSIONS[celebrating.missionId].title);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-6">
      <div className="relative">
        {PIECES.map((piece, i) => (
          <span
            key={i}
            className="tour-confetti"
            style={
              {
                "--x": `${piece.x}px`,
                "--y": `${piece.y}px`,
                "--r": `${piece.rotation}deg`,
                "--delay": `${piece.delay}s`,
                background: piece.color,
              } as CSSProperties
            }
          />
        ))}
        <div className="pwa-pop pointer-events-auto w-72 rounded-2xl border bg-card p-5 text-center shadow-2xl">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success text-success-foreground">
            {all ? <PartyPopper className="size-6" /> : <Check className="size-6" strokeWidth={3} />}
          </span>
          <p className="mt-3 text-lg font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {all ? (
            <Button className="mt-4 w-full" onClick={clearCelebration}>
              Começar a usar
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
