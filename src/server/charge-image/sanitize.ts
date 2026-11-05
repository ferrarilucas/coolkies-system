const SORA_RANGES: readonly (readonly [number, number])[] = [
  [0x0020, 0x007e],
  [0x00a0, 0x00ac],
  [0x00ae, 0x00ff],
  [0x0100, 0x0123],
  [0x0126, 0x0131],
  [0x0134, 0x0137],
  [0x0139, 0x013e],
  [0x0141, 0x0148],
  [0x014a, 0x017e],
  [0x01fa, 0x01fa],
  [0x0218, 0x021b],
  [0x0237, 0x0237],
  [0x1e80, 0x1e85],
  [0x1e9e, 0x1e9e],
  [0x1ef2, 0x1ef3],
  [0x2013, 0x2014],
  [0x2018, 0x201a],
  [0x201c, 0x201e],
  [0x2020, 0x2020],
  [0x2022, 0x2022],
  [0x2026, 0x2026],
  [0x2032, 0x2033],
  [0x2039, 0x203a],
  [0x2044, 0x2044],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
];

const DASHES = new Set([0x2010, 0x2011, 0x2012, 0x2015, 0x2043]);
const SPACES = new Set([0x00ad, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);

export function isRenderableCodePoint(codePoint: number): boolean {
  return SORA_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isSpace(char: string, codePoint: number): boolean {
  return /\s/u.test(char) || SPACES.has(codePoint) || (codePoint >= 0x2000 && codePoint <= 0x200a);
}

function fallback(char: string): string {
  let out = "";
  for (const composed of char.normalize("NFKD").normalize("NFC")) {
    if (isRenderableCodePoint(composed.codePointAt(0)!)) {
      out += composed;
      continue;
    }
    for (const base of composed.normalize("NFD")) {
      if (isRenderableCodePoint(base.codePointAt(0)!)) out += base;
    }
  }
  return out;
}

export function sanitizeImageText(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const codePoint = char.codePointAt(0)!;
    if (isSpace(char, codePoint)) out += " ";
    else if (isRenderableCodePoint(codePoint)) out += char;
    else if (DASHES.has(codePoint)) out += "-";
    else if (!/\p{Extended_Pictographic}/u.test(char)) out += fallback(char);
  }
  return out.replace(/ {2,}/g, " ").trim();
}
