"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOnboarding } from "./onboarding-context";

export function DismissOnboardingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const onboarding = useOnboarding();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Esconder os primeiros passos?</DialogTitle>
          <DialogDescription>
            O card e o atalho somem. Você pode retomar quando quiser em Ajustes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Manter
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              void onboarding.dismiss();
            }}
          >
            Esconder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
