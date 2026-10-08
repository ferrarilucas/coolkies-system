"use client";

import { useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";
import { InstallGuide } from "./install-guide";
import { useInstallContext, useInstallPrompt } from "./use-install-context";

const STORAGE_KEY = "cipri:install-banner-dismissed";

export function InstallBanner() {
  const context = useInstallContext();
  const install = useInstallPrompt();
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  }

  if (!context || context.isStandalone || context.platform === "other") return null;

  const { platform } = context;

  async function handleAction() {
    if (platform === "android" && install) {
      if (await install()) dismiss();
      return;
    }
    setOpen(true);
  }

  return (
    <>
      {!dismissed && (
        <div className="border-b bg-accent/60 px-4 py-1.5 md:hidden">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2 text-xs">
            <Smartphone className="size-3.5 shrink-0 text-accent-foreground" />
            <span className="min-w-0 flex-1 truncate text-accent-foreground">
              {platform === "ios"
                ? "Use o Cipri como app no iPhone"
                : "Use o Cipri como app no Android"}
            </span>
            <button
              type="button"
              onClick={handleAction}
              className="shrink-0 font-medium text-primary underline underline-offset-4"
            >
              {platform === "android" && install ? "Instalar" : "Ver como"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dispensar aviso"
              className="-mr-1 shrink-0 rounded p-1 text-muted-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
      <InstallGuide
        platform={context.guidePlatform}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) dismiss();
        }}
      />
    </>
  );
}
