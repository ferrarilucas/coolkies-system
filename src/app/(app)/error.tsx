"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertTriangle className="size-7 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold">Algo deu errado</h2>
      <p className="mb-6 mt-1 max-w-sm text-sm text-muted-foreground">
        Não foi possível carregar esta tela. Verifique sua conexão e tente novamente.
      </p>
      <Button onClick={reset}>
        <RotateCcw className="size-4" />
        Tentar novamente
      </Button>
    </div>
  );
}
