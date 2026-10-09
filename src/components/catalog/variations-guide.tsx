"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Check, CircleHelp, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { timing } from "@/components/pwa/guide-parts";
import { cn } from "@/lib/utils";

const STEP_MS = 5200;

function Chip({ children, delay }: { children: ReactNode; delay: number }) {
  return (
    <span
      className="pwa-pop inline-flex h-6 items-center rounded-md border bg-background px-2 text-[11px] font-medium"
      style={timing(delay)}
    >
      {children}
    </span>
  );
}

function OptionBlock({ name, values, delay }: { name: string; values: string[]; delay: number }) {
  return (
    <div className="pwa-fade space-y-2 rounded-lg border bg-card p-2.5" style={timing(delay)}>
      <p className="text-[10px] text-muted-foreground">Tipo de variação</p>
      <div className="rounded-md border bg-background px-2 py-1 text-xs font-semibold">{name}</div>
      <p className="text-[10px] text-muted-foreground">Opções</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value, i) => (
          <Chip key={value} delay={delay + 0.4 + i * 0.18}>
            {value}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function SceneVersions() {
  const versions = ["Nutella", "Doce de leite", "Ninho"];
  return (
    <div className="w-full max-w-72">
      <div
        className="pwa-pop mx-auto flex w-40 items-center gap-2 rounded-xl border bg-card p-2.5 shadow-sm"
        style={timing(0.1)}
      >
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
          <Package className="size-4 text-primary" />
        </div>
        <div>
          <p className="text-xs font-semibold">Brownie</p>
          <p className="text-[10px] text-muted-foreground">1 produto</p>
        </div>
      </div>
      <svg viewBox="0 0 288 44" className="h-11 w-full overflow-visible" aria-hidden>
        {[48, 144, 240].map((x, i) => (
          <path
            key={x}
            d={`M144 2 C144 24, ${x} 18, ${x} 42`}
            pathLength={1}
            className="pwa-draw fill-none stroke-primary/60"
            strokeWidth={2}
            strokeLinecap="round"
            style={timing(0.6 + i * 0.12, 0.6)}
          />
        ))}
      </svg>
      <div className="grid grid-cols-3 gap-2">
        {versions.map((version, i) => (
          <div
            key={version}
            className="pwa-pop flex h-14 flex-col items-center justify-center rounded-lg border bg-card px-1 text-center"
            style={timing(1.2 + i * 0.2)}
          >
            <span className="text-[10px] text-muted-foreground">Sabor</span>
            <span className="text-[11px] font-semibold leading-tight">{version}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneTypes() {
  return (
    <div className="w-full max-w-72 space-y-2.5">
      <OptionBlock name="Sabor" values={["Nutella", "Doce de leite", "Ninho"]} delay={0.1} />
      <OptionBlock name="Tamanho" values={["Mini", "Tradicional"]} delay={1.5} />
    </div>
  );
}

const combos = [
  { name: "Nutella · Mini", on: true },
  { name: "Nutella · Tradicional", on: true },
  { name: "Doce de leite · Mini", on: true },
  { name: "Doce de leite · Tradicional", on: true },
  { name: "Ninho · Mini", on: false },
  { name: "Ninho · Tradicional", on: true },
];

function SceneCombinations() {
  return (
    <div className="w-full max-w-72 space-y-2">
      <p className="pwa-fade text-center text-[11px] text-muted-foreground" style={timing(0.1)}>
        3 sabores × 2 tamanhos = <span className="font-semibold text-foreground">6 combinações</span>
      </p>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {combos.map(({ name, on }, i) => (
          <li
            key={name}
            className={cn("pwa-fade flex items-center gap-2 px-2.5 py-1.5", !on && "text-muted-foreground")}
            style={timing(0.3 + i * 0.12)}
          >
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                on ? "border-primary bg-primary" : "border-muted-foreground/50",
              )}
            >
              {on && (
                <Check
                  className="pwa-pop size-2.5 text-primary-foreground"
                  strokeWidth={4}
                  style={timing(1.3 + i * 0.15)}
                />
              )}
            </span>
            <span className="text-[11px] font-medium">{name}</span>
            {!on && (
              <span className="pwa-fade ml-auto text-[10px]" style={timing(2.4)}>
                não vendo
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniSwitch({ turnsOff }: { turnsOff?: boolean }) {
  const style = timing(2.4) as CSSProperties;
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn("relative h-3.5 w-6 rounded-full bg-primary", turnsOff && "vg-track-off")}
        style={turnsOff ? style : undefined}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 size-2.5 translate-x-2.5 rounded-full bg-background",
            turnsOff && "vg-thumb-off",
          )}
          style={turnsOff ? style : undefined}
        />
      </span>
      <span className="grid w-14 text-[10px] text-muted-foreground">
        <span className={cn("col-start-1 row-start-1", turnsOff && "vg-fade-out")} style={turnsOff ? style : undefined}>
          Disponível
        </span>
        {turnsOff && (
          <span className="pwa-fade col-start-1 row-start-1" style={style}>
            Pausada
          </span>
        )}
      </span>
    </span>
  );
}

function ScenePricing() {
  const rows = [
    { name: "Nutella · Tradicional", price: "R$ 14,00" },
    { name: "Nutella · Mini", price: "R$ 0,00", usesDefault: true },
    { name: "Ninho · Tradicional", price: "R$ 15,00", pauses: true },
  ];
  return (
    <ul className="w-full max-w-72 space-y-2">
      {rows.map(({ name, price, usesDefault, pauses }, i) => (
        <li key={name} className="pwa-fade rounded-lg border bg-card" style={timing(0.1 + i * 0.2)}>
          <div className={cn("space-y-1.5 p-2.5", pauses && "vg-dim")} style={pauses ? timing(2.4) : undefined}>
            <p className="text-[11px] font-semibold">{name}</p>
            <div className="flex items-center gap-2">
              <span className="rounded-md border bg-background px-1.5 py-0.5 text-[10px] tabular-nums">{price}</span>
              {usesDefault ? (
                <span
                  className="pwa-pop rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning-text"
                  style={timing(1.2)}
                >
                  usa o preço padrão
                </span>
              ) : (
                <span className="truncate text-[10px] text-muted-foreground">Ficha: Brownie</span>
              )}
              <span className="ml-auto">
                <MiniSwitch turnsOff={pauses} />
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const steps: { title: string; description: string; Scene: () => ReactNode }[] = [
  {
    title: "Um produto, várias versões",
    description:
      "Use variações quando o mesmo produto sai em versões diferentes, como sabores ou tamanhos. Fica tudo num produto só, em vez de cadastrar um para cada.",
    Scene: SceneVersions,
  },
  {
    title: "Tipos e opções",
    description:
      "O tipo é o que muda (Sabor, Tamanho). As opções são as escolhas de cada tipo. Dá para criar até 3 tipos por produto.",
    Scene: SceneTypes,
  },
  {
    title: "Marque o que você vende",
    description: "O app cruza as opções de cada tipo e monta as combinações. Marque só as que você realmente vende.",
    Scene: SceneCombinations,
  },
  {
    title: "Preço, ficha e estoque próprios",
    description:
      "Cada combinação tem preço, ficha técnica e estoque próprios. Deixe R$ 0,00 para usar o preço padrão e pause o que estiver em falta: some da venda sem perder o histórico.",
    Scene: ScenePricing,
  },
];

export function VariationsGuide() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const last = step === steps.length - 1;
  const { title, description, Scene } = steps[step];

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  function go(next: number) {
    setStep(Math.max(0, Math.min(steps.length - 1, next)));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="-m-1.5 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="O que são variações?"
      >
        <CircleHelp className="size-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm gap-0 overflow-hidden rounded-2xl p-0 sm:rounded-2xl">
          <div
            className="relative flex h-[min(52dvh,370px)] select-none items-center justify-center bg-secondary/60 bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:14px_14px] px-5 pb-4 pt-9"
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
                    key={i === step ? `active-${step}` : i}
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
            <div key={step} className="pwa-scene flex w-full justify-center" aria-hidden>
              <Scene />
            </div>
          </div>

          <div className="space-y-4 border-t bg-background p-5">
            <div key={step} className="space-y-1.5 duration-500 animate-in fade-in slide-in-from-bottom-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Passo {step + 1} de {steps.length}
              </p>
              <DialogTitle className="text-lg">{title}</DialogTitle>
              <DialogDescription className="leading-relaxed">{description}</DialogDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => go(step - 1)} disabled={step === 0}>
                Voltar
              </Button>
              {last ? (
                <Button className="flex-1" onClick={() => setOpen(false)}>
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
    </>
  );
}
