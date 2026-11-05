import { formatBRL } from "@/lib/money";

export const DEFAULT_CHARGE_TEMPLATE = [
  "Oi, {nome}! Tudo bem?",
  "Passando para lembrar do valor em aberto de {valor}.",
  "Pix: {pix}",
  "Qualquer dúvida, é só me chamar. Obrigado!",
].join("\n");

export const CHARGE_TEMPLATE_MAX = 1000;

export const CHARGE_VARIABLES = ["{nome}", "{nome_completo}", "{valor}", "{pix}"] as const;

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0];
}

export function formatChargeAmount(cents: number): string {
  return formatBRL(cents).replace(/[\u00A0\u202F]/g, " ");
}

export function renderChargeMessage(input: {
  template: string | null;
  customerName: string;
  totalCents: number;
  pixKey: string | null;
}): string {
  const template = input.template?.trim() ? input.template : DEFAULT_CHARGE_TEMPLATE;
  const fullName = input.customerName.trim().replace(/\s+/g, " ");
  const values: Record<string, string> = {
    nome_completo: fullName,
    nome: firstName(fullName),
    valor: formatChargeAmount(input.totalCents),
    pix: input.pixKey?.trim() ?? "",
  };
  const pattern = /\{(nome_completo|nome|valor|pix)\}/g;

  return template
    .split("\n")
    .filter((line) => !Array.from(line.matchAll(pattern)).some(([, key]) => values[key] === ""))
    .map((line) => line.replace(pattern, (_, key: string) => values[key]))
    .join("\n");
}
