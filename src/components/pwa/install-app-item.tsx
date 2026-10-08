"use client";

import { useState } from "react";
import { ChevronRight, Smartphone } from "lucide-react";
import { InstallGuide } from "./install-guide";
import { useInstallContext } from "./use-install-context";

const labels = {
  ios: "Instalar no iPhone",
  android: "Instalar no Android",
  other: "Instalar no celular",
};

export function InstallAppItem() {
  const context = useInstallContext();
  const [open, setOpen] = useState(false);

  if (!context || context.isStandalone) return null;

  const { platform } = context;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 active:bg-muted"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/20">
          <Smartphone className="size-4 text-warning-text" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{labels[platform]}</p>
          <p className="truncate text-xs text-muted-foreground">
            Coloque o Cipri na tela inicial, como um app
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <InstallGuide
        platform={context.guidePlatform}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
