export type CheckoutViewState =
  | { kind: "authorize"; pixCopyPaste: string; nextDueDate: string | null }
  | { kind: "waiting"; nextDueDate: string | null }
  | { kind: "failed" }
  | { kind: "none" };

export function checkoutViewState(
  status: string | null,
  pixCopyPaste: string | null,
  nextDueDate: string | null,
  graceUntil: string | null,
): CheckoutViewState {
  if (status !== "PENDING_AUTH") return { kind: "none" };
  if (graceUntil) return { kind: "waiting", nextDueDate };
  if (pixCopyPaste) return { kind: "authorize", pixCopyPaste, nextDueDate };
  return { kind: "failed" };
}
