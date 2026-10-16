"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DismissOnboardingDialog } from "./dismiss-dialog";
import { MissionsList } from "./missions-list";
import { useOnboarding } from "./onboarding-context";

export function MissionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const onboarding = useOnboarding();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { done, total } = onboarding.counts;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bottom-0 top-auto max-h-[85dvh] translate-y-0 overflow-y-auto rounded-b-none rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[state=closed]:slide-out-to-top-[100%] data-[state=open]:slide-in-from-top-[100%] sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle>Primeiros passos</DialogTitle>
            <DialogDescription>
              {done} de {total} concluídas
            </DialogDescription>
          </DialogHeader>
          <MissionsList onStart={() => onOpenChange(false)} />
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="mx-auto text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Esconder primeiros passos
          </button>
        </DialogContent>
      </Dialog>
      <DismissOnboardingDialog
        open={confirmOpen}
        onOpenChange={(value) => {
          setConfirmOpen(value);
          if (!value && onboarding.state.dismissed) onOpenChange(false);
        }}
      />
    </>
  );
}
