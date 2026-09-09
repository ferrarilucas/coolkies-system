export type CheckoutViewState =
  | { kind: "authorize"; pixCopyPaste: string; nextDueDate: string | null }
  | { kind: "waiting"; nextDueDate: string | null }
  | { kind: "expired"; nextDueDate: string | null }
  | { kind: "failed" }
  | { kind: "none" };

export function checkoutViewState(
  status: string | null,
  pixCopyPaste: string | null,
  nextDueDate: string | null,
  graceUntil: string | null,
  now: Date = new Date(),
): CheckoutViewState {
  if (status !== "PENDING_AUTH") return { kind: "none" };
  if (graceUntil) {
    const graceDate = new Date(graceUntil);
    if (Number.isNaN(graceDate.getTime())) {
      return { kind: "failed" };
    }
    if (graceDate <= now) {
      return { kind: "expired", nextDueDate };
    }
    return { kind: "waiting", nextDueDate };
  }
  if (pixCopyPaste) return { kind: "authorize", pixCopyPaste, nextDueDate };
  return { kind: "failed" };
}
