export type CheckoutViewState =
  | { kind: "authorize"; pixCopyPaste: string; nextDueDate: string | null }
  | { kind: "waiting"; nextDueDate: string | null }
  | { kind: "none" };

export function checkoutViewState(
  status: string | null,
  pixCopyPaste: string | null,
  nextDueDate: string | null,
): CheckoutViewState {
  if (status !== "PENDING_AUTH") return { kind: "none" };
  if (pixCopyPaste) return { kind: "authorize", pixCopyPaste, nextDueDate };
  return { kind: "waiting", nextDueDate };
}
