"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timing } from "@/components/pwa/guide-parts";
import { cn } from "@/lib/utils";
import { useOnboarding } from "./onboarding-context";

export function MissionsList({ onStart }: { onStart?: () => void }) {
  const onboarding = useOnboarding();
  const progress = onboarding.state.progress;

  return (
    <ul className="space-y-1">
      {onboarding.missions.map((mission, index) => {
        const done = progress?.[mission.id] ?? false;
        const isNext = onboarding.nextMission?.id === mission.id;
        return (
          <li
            key={mission.id}
            className={cn("pwa-fade flex items-center gap-3 rounded-lg p-2", isNext && "bg-primary/5")}
            style={timing(index * 0.06)}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                done ? "border-success bg-success text-success-foreground" : "border-border",
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>
                {onboarding.text(mission.title)}
              </p>
              {!done ? <p className="text-xs text-muted-foreground">{onboarding.text(mission.description)}</p> : null}
            </div>
            {!done ? (
              <Button
                size="sm"
                variant={isNext ? "default" : "outline"}
                onClick={() => {
                  onStart?.();
                  onboarding.startMission(mission.id);
                }}
              >
                {onboarding.pausedMissionId === mission.id ? "Continuar" : "Fazer"}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
