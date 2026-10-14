/**
 * Como o preço de um item de compra foi informado:
 * - TOTAL: o valor pago pelo item inteiro (ex.: 180 g de fermento por R$ 6,00)
 * - UNIT:  o preço por unidade escolhida (ex.: batata a R$ 5,00/kg), o sistema multiplica
 */
export type PriceMode = "TOTAL" | "UNIT";

/** Valor total pago pela linha, em centavos. */
export function lineTotalCents(mode: PriceMode, priceCents: number, quantity: number): number {
  if (mode === "TOTAL") return priceCents;
  if (!(quantity > 0)) return 0;
  return Math.round(quantity * priceCents);
}

/** Converte o valor digitado ao trocar o modo, preservando o total da linha. */
export function convertPriceMode(
  from: PriceMode,
  to: PriceMode,
  priceCents: number,
  quantity: number,
): number {
  if (from === to) return priceCents;
  const total = lineTotalCents(from, priceCents, quantity);
  if (to === "TOTAL") return total;
  return quantity > 0 ? Math.round(total / quantity) : 0;
}
