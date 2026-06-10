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

/**
 * Custo por unidade base a partir de uma compra.
 * Ex.: paguei 250 centavos por 1000g -> 0.25 centavos/g.
 * Retorna centavos por unidade (pode ser fracionário).
 */
export function unitCost(pricePaidCents: number, quantity: number): number {
  if (quantity <= 0) return 0;
  return pricePaidCents / quantity;
}
