import type { Axis } from "./sectors";

export type GuideExample = { produto: string; eixos: [Axis, Axis] };

export type GuideCombo = { name: string; on: boolean };

export type GuidePriceRow = { name: string; price: string; usesDefault?: boolean; pauses?: boolean };

export const DEFAULT_GUIDE_EXAMPLE: GuideExample = {
  produto: "Brownie",
  eixos: [
    { nome: "Sabor", opcoes: ["Nutella", "Doce de leite", "Ninho"] },
    { nome: "Tamanho", opcoes: ["Mini", "Tradicional"] },
  ],
};

export function guideCombos(example: GuideExample): GuideCombo[] {
  const [first, second] = example.eixos;
  const names = first.opcoes.flatMap((a) => second.opcoes.map((b) => `${a} · ${b}`));
  const off = names.length - 2;
  return names.map((name, index) => ({ name, on: index !== off }));
}

export function guidePricingRows(example: GuideExample): GuidePriceRow[] {
  const combos = guideCombos(example);
  return [
    { name: combos[1].name, price: "R$ 14,00" },
    { name: combos[0].name, price: "R$ 0,00", usesDefault: true },
    { name: combos[combos.length - 1].name, price: "R$ 15,00", pauses: true },
  ];
}
