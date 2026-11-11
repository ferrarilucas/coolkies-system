export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function tokens(text: string) {
  return normalizeSearch(text).match(/[a-z0-9]+/g)
    ?.filter((word) => !["de", "da", "do", "com"].includes(word))
    .map((word) => word.length > 4 ? word.replace(/s$/, "") : word) ?? [];
}

function editDistance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) {
      next.push(Math.min(row[j + 1] + 1, next[j] + 1, row[j] + Number(a[i] !== b[j])));
    }
    row = next;
  }
  return row[b.length];
}

export function matchNames<T>(query: string, options: T[], label: (option: T) => string): T[] {
  const words = tokens(query);
  if (!words.length) return [];
  let best = Number.POSITIVE_INFINITY;
  let matches: T[] = [];
  for (const option of options) {
    const candidate = tokens(label(option));
    const score = words.reduce((sum, word) => sum + Math.min(...candidate.map((other) => {
      if (word === other) return 0;
      if (word.length < 5 || Math.abs(word.length - other.length) > 2) return Number.POSITIVE_INFINITY;
      const distance = editDistance(word, other);
      return distance <= (word.length >= 7 ? 2 : 1) ? distance : Number.POSITIVE_INFINITY;
    })), 0);
    if (!Number.isFinite(score) || score > best) continue;
    if (score < best) {
      best = score;
      matches = [];
    }
    matches.push(option);
  }
  return matches;
}
