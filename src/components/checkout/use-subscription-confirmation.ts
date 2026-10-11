"use client";

import { useEffect, useState } from "react";
import {
  confirmationOutcome,
  type ConfirmationOutcome,
  type SubscriptionState,
} from "@/lib/subscription-confirmation";

const RECONNECT_DELAY_MS = 5_000;

export function useSubscriptionConfirmation(enabled: boolean): {
  outcome: ConfirmationOutcome;
  state: SubscriptionState | null;
} {
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [outcome, setOutcome] = useState<ConfirmationOutcome>("waiting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (enabled) return;
    setOutcome("waiting");
    setState(null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || outcome !== "waiting") return;

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/subscription/events");

    source.addEventListener("state", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as SubscriptionState | null;
      setState(next);
      const result = confirmationOutcome(next);
      if (result !== "waiting") {
        setOutcome(result);
        source.close();
      }
    });

    source.addEventListener("error", () => {
      if (source.readyState !== EventSource.CLOSED || retryTimer) return;
      retryTimer = setTimeout(() => setAttempt((value) => value + 1), RECONNECT_DELAY_MS);
    });

    function reopen() {
      setAttempt((value) => value + 1);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") reopen();
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) reopen();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      source.close();
    };
  }, [enabled, outcome, attempt]);

  return { outcome, state };
}
