import { onlyDigits } from "@/lib/cpf";

export function normalizeBrPhone(raw: string | null | undefined): string | null {
  const digits = onlyDigits(raw ?? "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return null;
}

export function whatsappUrl(text: string, phone?: string | null): string {
  const number = normalizeBrPhone(phone);
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`;
}
