export type SubscriptionState = {
  status: string;
  provider: string;
  authorized: boolean;
  plan: string;
  cycle: string;
  nextDueDate: string | null;
};

export type ConfirmationOutcome = "waiting" | "confirmed" | "failed";

export function confirmationOutcome(state: SubscriptionState | null): ConfirmationOutcome {
  if (!state) return "waiting";
  if (state.status === "AUTH_DENIED") return "failed";
  if (state.provider === "INTERPIX" && state.authorized) return "confirmed";
  if (state.provider === "STRIPE" && state.status === "ACTIVE") return "confirmed";
  return "waiting";
}
