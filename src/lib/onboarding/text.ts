import type { SectorExamples } from "./sectors";

export function joinOptions(options: string[]): string {
  if (options.length <= 1) return options.join("");
  return `${options.slice(0, -1).join(", ")} e ${options[options.length - 1]}`;
}

export function fillText(text: string, examples: SectorExamples): string {
  const [eixo, eixo2] = examples.eixos;
  const values: Record<string, string> = {
    boasVindas: examples.boasVindas,
    produto: examples.produto,
    insumo: examples.insumo ?? "o insumo",
    fornecedor: examples.fornecedor,
    eixo: eixo.nome,
    opcoes: joinOptions(eixo.opcoes),
    eixo2: eixo2.nome,
    opcoes2: joinOptions(eixo2.opcoes),
  };
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
