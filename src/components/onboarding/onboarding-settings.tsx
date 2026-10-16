"use client";

import { useTransition, type ComponentType } from "react";
import { ChevronRight, ListChecks, Sparkles } from "lucide-react";
import { useOnboarding } from "./onboarding-context";

function SettingsRow({
  icon: Icon,
  label,
  description,
  onClick,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 active:bg-muted disabled:opacity-60"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function OnboardingSettings() {
  const onboarding = useOnboarding();
  const [pending, startTransition] = useTransition();
  const canResume = onboarding.state.eligible && onboarding.state.dismissed;

  return (
    <div className="divide-y rounded-lg border bg-card">
      {canResume ? (
        <SettingsRow
          icon={ListChecks}
          label="Retomar primeiros passos"
          description="Volta a mostrar as missões no Painel"
          onClick={() => startTransition(onboarding.resume)}
          disabled={pending}
        />
      ) : null}
      <SettingsRow
        icon={Sparkles}
        label="Rever tour do app"
        description="Mostra de novo onde fica cada coisa"
        onClick={() => startTransition(onboarding.restartTour)}
        disabled={pending}
      />
    </div>
  );
}
