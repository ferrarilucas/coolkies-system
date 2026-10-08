"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { androidSteps } from "./android-steps";
import { Phone, type PhoneVariant } from "./guide-parts";
import { iosSteps } from "./ios-steps";
import { useInstallPrompt } from "./use-install-context";

const STEP_MS = 5200;

const platforms: { value: PhoneVariant; label: string }[] = [
  { value: "ios", label: "iPhone" },
  { value: "android", label: "Android" },
];

export function InstallGuide({
  platform,
  open,
  onOpenChange,
}: {
  platform: PhoneVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [current, setCurrent] = useState<PhoneVariant>(platform);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const install = useInstallPrompt();
  const steps = current === "ios" ? iosSteps : androidSteps;
  const last = step === steps.length - 1;
  const { title, description, Scene } = steps[step];

  useEffect(() => {
    if (open) {
      setCurrent(platform);
      setStep(0);
    }
  }, [open, platform]);

  function switchTo(next: PhoneVariant) {
    setCurrent(next);
    setStep(0);
  }

  async function installNow() {
    if (!install) return;
    const accepted = await install();
    if (accepted) onOpenChange(false);
  }

  function go(next: number) {
    setStep(Math.max(0, Math.min(steps.length - 1, next)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm gap-0 overflow-hidden rounded-2xl p-0 sm:rounded-2xl">
        <div
          className="relative flex h-[min(52dvh,380px)] select-none items-center justify-center bg-secondary/60 bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:14px_14px] px-6 pb-4 pt-9"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
        >
          <div className="absolute inset-x-4 top-4 flex gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                onClick={() => go(i)}
                aria-label={`Ir para o passo ${i + 1}`}
                className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10"
              >
                <span
                  key={i === step ? `active-${current}-${step}` : i}
                  className={cn(
                    "block h-full rounded-full bg-primary",
                    i < step && "w-full",
                    i > step && "w-0",
                    i === step && "pwa-progress",
                  )}
                  style={
                    i === step
                      ? ({
                          "--dur": `${STEP_MS}ms`,
                          animationPlayState: paused ? "paused" : "running",
                        } as CSSProperties)
                      : undefined
                  }
                  onAnimationEnd={() => {
                    if (i === step && !last) go(step + 1);
                  }}
                />
              </button>
            ))}
          </div>
          <div key={`${current}-${step}`} className="pwa-scene h-full">
            <Phone variant={current}>
              <Scene />
            </Phone>
          </div>
        </div>

        <div className="space-y-4 border-t bg-background p-5">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {platforms.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => switchTo(value)}
                aria-pressed={current === value}
                className={cn(
                  "rounded-md py-1.5 text-sm font-medium transition-colors",
                  current === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div key={`${current}-${step}`} className="space-y-1.5 duration-500 animate-in fade-in slide-in-from-bottom-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Passo {step + 1} de {steps.length}
            </p>
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription className="leading-relaxed">{description}</DialogDescription>
          </div>
          {current === "android" && install && (
            <Button variant="outline" className="w-full" onClick={installNow}>
              <Download />
              Instalar agora
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => go(step - 1)}
              disabled={step === 0}
            >
              Voltar
            </Button>
            {last ? (
              <Button className="flex-1" onClick={() => onOpenChange(false)}>
                Entendi
              </Button>
            ) : (
              <Button className="flex-1" onClick={() => go(step + 1)}>
                Próximo
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
