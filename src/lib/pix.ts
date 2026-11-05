import { onlyDigits } from "@/lib/cpf";
import { normalizeBrPhone } from "@/lib/whatsapp";

export const PIX_KEY_TYPES = ["CPF", "CNPJ", "PHONE", "EMAIL", "EVP"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  PHONE: "Telefone",
  EMAIL: "E-mail",
  EVP: "Aleatória",
};

export const PIX_KEY_MAX = 77;
export const PIX_NAME_MAX = 25;
export const PIX_CITY_MAX = 15;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_KEY_RE = /^\+55\d{2}9\d{8}$/;
const EMV_VALUE_RE = /^[\x20-\x7E]*$/;
const EMV_VALUE_MAX = 99;
const EVP_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPixKeyType(value: unknown): value is PixKeyType {
  return (
    typeof value === "string" &&
    (PIX_KEY_TYPES as readonly string[]).includes(value)
  );
}

function allSameDigit(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce(
    (acc, weight, i) => acc + Number(digits[i]) * weight,
    0,
  );
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11 || allSameDigit(d)) return false;
  const first = checkDigit(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[9]) && second === Number(d[10]);
}

export function isValidCnpj(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14 || allSameDigit(d)) return false;
  const first = checkDigit(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[12]) && second === Number(d[13]);
}

export function normalizePixKey(
  type: PixKeyType,
  raw: string,
): { ok: true; key: string } | { ok: false; error: string } {
  const invalid = {
    ok: false as const,
    error: `Chave Pix inválida para ${PIX_KEY_TYPE_LABELS[type]}.`,
  };
  const value = raw.trim();
  let key: string | null = null;

  if (type === "CPF") key = isValidCpf(value) ? onlyDigits(value) : null;
  else if (type === "CNPJ") key = isValidCnpj(value) ? onlyDigits(value) : null;
  else if (type === "PHONE") {
    const phone = normalizeBrPhone(value);
    const candidate = phone ? `+${phone}` : null;
    key = candidate && PHONE_KEY_RE.test(candidate) ? candidate : null;
  } else if (type === "EMAIL") {
    const email = value.toLowerCase();
    key = EMAIL_RE.test(email) ? email : null;
  } else {
    const evp = value.toLowerCase();
    key = EVP_RE.test(evp) ? evp : null;
  }

  if (!key || key.length > PIX_KEY_MAX) return invalid;
  return { ok: true, key };
}

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function field(id: string, value: string): string {
  if (!EMV_VALUE_RE.test(value))
    throw new Error(
      `Campo ${id} do Pix tem caractere fora de ASCII imprimível.`,
    );
  if (value.length > EMV_VALUE_MAX)
    throw new Error(`Campo ${id} do Pix passa de ${EMV_VALUE_MAX} caracteres.`);
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

export function assemblePixPayload(input: {
  key: string;
  name: string;
  city: string;
  amount?: string;
}): string {
  const body = [
    field("00", "01"),
    field("26", field("00", "br.gov.bcb.pix") + field("01", input.key)),
    field("52", "0000"),
    field("53", "986"),
    input.amount ? field("54", input.amount) : "",
    field("58", "BR"),
    field("59", input.name),
    field("60", input.city),
    field("62", field("05", "***")),
    "6304",
  ].join("");
  return body + crc16(body);
}

function pixText(value: string, max: number): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export function buildPixCopyPaste(input: {
  key: string;
  name: string;
  city: string;
  amountCents: number;
}): string {
  return assemblePixPayload({
    key: input.key,
    name: pixText(input.name, PIX_NAME_MAX),
    city: pixText(input.city, PIX_CITY_MAX),
    amount:
      Number.isSafeInteger(input.amountCents) && input.amountCents > 0
        ? (input.amountCents / 100).toFixed(2)
        : undefined,
  });
}

export function isPixConfigured(settings: {
  pixKey: string | null;
  pixRecipientName: string | null;
  pixCity: string | null;
}): boolean {
  const key = settings.pixKey?.trim() ?? "";
  return Boolean(
    key &&
    key.length <= PIX_KEY_MAX &&
    pixText(settings.pixRecipientName ?? "", PIX_NAME_MAX) &&
    pixText(settings.pixCity ?? "", PIX_CITY_MAX),
  );
}
