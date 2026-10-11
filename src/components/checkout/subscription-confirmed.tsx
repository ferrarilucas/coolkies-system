"use client";

import { useEffect, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const REDIRECT_MS = 3000;

function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties;
}

export function SubscriptionConfirmed({ detail }: { detail: string }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.replace("/dashboard"), REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 px-6 backdrop-blur-sm"
    >
      <div className="pwa-scene flex w-full max-w-sm flex-col items-center text-center">
        <svg viewBox="0 0 96 96" className="size-24" aria-hidden>
          <circle cx="48" cy="48" r="44" className="pwa-pop fill-primary" style={cssVars({ "--delay": "0s" })} />
          <path
            d="M30 49 L43 62 L67 36"
            pathLength={1}
            className="pwa-draw fill-none stroke-primary-foreground"
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={cssVars({ "--delay": "0.35s", "--dur": "0.5s" })}
          />
        </svg>
        <h2 className="mt-6 text-2xl font-semibold tracking-tight">Assinatura confirmada!</h2>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        <div className="mt-8 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="pwa-progress h-full bg-primary" style={cssVars({ "--dur": "3s" })} />
        </div>
        <Button className="mt-6" onClick={() => router.replace("/dashboard")}>
          Ir para o painel
        </Button>
      </div>
    </div>
  );
}
