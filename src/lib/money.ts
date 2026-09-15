/**
 * Dinheiro é sempre armazenado em CENTAVOS (Int) no banco.
 * Estes helpers convertem para/de exibição em BRL.
 */

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** 250 (centavos) -> "R$ 2,50" */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100);
}

/** "2,50" | "R$ 2,50" | "2.50" -> 250 (centavos) */
export function parseBRL(input: string): number {
  const cleaned = input
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

