export function isLowStock(
  current: number,
  minStock: number | null | undefined,
): boolean {
  return minStock != null && minStock > 0 && current < minStock;
}
