export function normalizeName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return name;
  return name.charAt(0).toLocaleUpperCase("pt-BR") + name.slice(1);
}
