export function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function maskCpf(raw: string): string {
  return onlyDigits(raw)
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function isCompleteCpf(raw: string): boolean {
  return onlyDigits(raw).length === 11;
}
