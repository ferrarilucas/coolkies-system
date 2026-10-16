"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useIsFormRoute } from "@/components/layout/bottom-nav";
import { MissionsDialog } from "./missions-dialog";
import { useOnboarding } from "./onboarding-context";

export function OnboardingBubble() {
  const onboarding = useOnboarding();
  const pathname = usePathname();
  const isFormRoute = useIsFormRoute();
  const [open, setOpen] = useState(false);

  if (!onboarding.missionsVisible || onboarding.run || pathname === "/dashboard" || isFormRoute) return null;

  const { done, total } = onboarding.counts;
  const degrees = total > 0 ? (done / total) * 360 : 0;

  return (
    <>
      <button
        type="button"
        aria-label={`Primeiros passos: ${done} de ${total}`}
        onClick={() => setOpen(true)}
        className="pwa-pop fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-12 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 md:bottom-6 md:right-6"
        style={{
          backgroundImage: `conic-gradient(hsl(var(--primary)) ${degrees}deg, hsl(var(--muted)) 0deg)`,
        }}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-card text-xs font-semibold tabular-nums">
          {done}/{total}
        </span>
      </button>
      <MissionsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
