import { normalizeName } from "@/lib/text";

export const MAX_OPTIONS = 3;

export type OptionValueInput = { key: string; id: string | null; name: string };
export type OptionInput = { id: string | null; name: string; values: OptionValueInput[] };

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export function validateOptions(raw: OptionInput[]): Result<{ options: OptionInput[] }> {
  if (raw.length > MAX_OPTIONS) {
    return { ok: false, error: `Um produto pode ter no máximo ${MAX_OPTIONS} tipos de variação.` };
  }

  const options: OptionInput[] = [];
  const optionNames = new Set<string>();

  for (const option of raw) {
    const name = normalizeName(option.name);
    if (!name) return { ok: false, error: "Dê um nome a cada tipo de variação, como Sabor ou Tamanho." };

    const optionKey = name.toLocaleLowerCase("pt-BR");
    if (optionNames.has(optionKey)) return { ok: false, error: `O tipo de variação "${name}" está repetido.` };
    optionNames.add(optionKey);

    const values: OptionValueInput[] = [];
    const valueNames = new Set<string>();
    for (const value of option.values) {
      const valueName = normalizeName(value.name);
      if (!valueName) continue;
      const valueKey = valueName.toLocaleLowerCase("pt-BR");
      if (valueNames.has(valueKey)) {
        return { ok: false, error: `A opção "${valueName}" está repetida em "${name}".` };
      }
      valueNames.add(valueKey);
      values.push({ ...value, name: valueName });
    }

    if (values.length === 0) {
      return { ok: false, error: `Adicione pelo menos uma opção em "${name}".` };
    }
    options.push({ ...option, name, values });
  }

  return { ok: true, options };
}

export function resolveCombination(
  options: OptionInput[],
  valueKeys: string[],
): Result<{ valueKeys: string[] }> {
  const remaining = new Set(valueKeys);
  const ordered: string[] = [];

  for (const option of options) {
    const matches = option.values.filter((v) => remaining.has(v.key));
    if (matches.length !== 1) {
      return { ok: false, error: `Escolha uma opção de "${option.name}" para cada combinação.` };
    }
    ordered.push(matches[0].key);
    remaining.delete(matches[0].key);
  }

  if (remaining.size > 0) return { ok: false, error: "A combinação tem uma opção que não existe mais." };
  return { ok: true, valueKeys: ordered };
}

export function combinationName(options: OptionInput[], orderedValueKeys: string[]): string {
  return orderedValueKeys
    .map((key, index) => options[index]?.values.find((v) => v.key === key)?.name ?? "")
    .join(" / ");
}

export function allCombinations(options: OptionInput[]): string[][] {
  if (options.length === 0) return [];
  return options.reduce<string[][]>(
    (acc, option) => acc.flatMap((prefix) => option.values.map((v) => [...prefix, v.key])),
    [[]],
  );
}

export type KeyedOption = OptionInput & { key: string };

export function combinationKey(valueKeys: string[]): string {
  return [...valueKeys].sort().join("|");
}

export function rebaseCombinations<T extends { valueKeys: string[]; needsReview?: boolean }>(
  prev: KeyedOption[],
  next: KeyedOption[],
  entries: T[],
): T[] {
  const optionOfValue = new Map<string, string>();
  for (const option of [...prev, ...next]) {
    for (const value of option.values) optionOfValue.set(value.key, option.key);
  }

  const seen = new Set<string>();
  const result: T[] = [];

  for (const entry of entries) {
    const byOption = new Map(entry.valueKeys.map((key) => [optionOfValue.get(key), key]));
    const keys: string[] = [];
    let review = entry.needsReview ?? false;
    let dropped = false;

    for (const option of next) {
      const key = byOption.get(option.key);
      if (key !== undefined) {
        if (!option.values.some((v) => v.key === key)) {
          dropped = true;
          break;
        }
        keys.push(key);
      } else if (option.values.length > 0) {
        keys.push(option.values[0].key);
        review = true;
      }
    }

    if (dropped) continue;
    const key = combinationKey(keys);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, valueKeys: keys, ...(review ? { needsReview: true } : {}) });
  }

  return result;
}

type VariantWithValues = { valueIds: string[] };
type Picked = Record<string, string>;

export function findVariantByValues<T extends VariantWithValues>(
  variants: T[],
  picked: Picked,
  optionCount: number,
): T | null {
  const chosen = Object.values(picked);
  if (chosen.length !== optionCount) return null;
  return variants.find((v) => chosen.every((id) => v.valueIds.includes(id))) ?? null;
}

export function isValueAvailable(
  variants: VariantWithValues[],
  picked: Picked,
  optionId: string,
  valueId: string,
): boolean {
  const others = Object.entries(picked)
    .filter(([id]) => id !== optionId)
    .map(([, value]) => value);
  return variants.some((v) => v.valueIds.includes(valueId) && others.every((id) => v.valueIds.includes(id)));
}
