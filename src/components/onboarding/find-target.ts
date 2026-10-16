export function findTarget(selector: string): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return candidates.find((element) => element.getClientRects().length > 0) ?? null;
}
