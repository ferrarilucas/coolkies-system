"use client";

import { useEffect, useState } from "react";
import {
  confirmationOutcome,
  type ConfirmationOutcome,
  type SubscriptionState,
} from "@/lib/subscription-confirmation";

export function useSubscriptionConfirmation(enabled: boolean): {
  outcome: ConfirmationOutcome;
  state: SubscriptionState | null;
} {
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [outcome, setOutcome] = useState<ConfirmationOutcome>("waiting");

  useEffect(() => {
    if (!enabled || outcome !== "waiting") return;

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

    return () => source.close();
  }, [enabled, outcome]);

  return { outcome, state };
}
