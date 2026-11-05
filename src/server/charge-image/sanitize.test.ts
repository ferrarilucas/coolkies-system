import { describe, expect, it } from "vitest";
import { isRenderableCodePoint, sanitizeImageText } from "./sanitize";

const cp = (...codePoints: number[]) => String.fromCodePoint(...codePoints);

describe("sanitizeImageText", () => {
  it("mantém português e latin-ext coberto pela Sora", () => {
    expect(sanitizeImageText("Pão de Açúcar — Łódź Ștefan Őrs")).toBe("Pão de Açúcar — Łódź Ștefan Őrs");
  });

  it("remove emoji, variation selectors e ZWJ", () => {
    expect(sanitizeImageText(`Cookie ${cp(0x1f36a)}`)).toBe("Cookie");
    expect(sanitizeImageText(`Família ${cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)} ok`)).toBe("Família ok");
    expect(sanitizeImageText(`Coração ${cp(0x2764, 0xfe0f)} doce`)).toBe("Coração doce");
    expect(sanitizeImageText(`a${cp(0x200b)}b${cp(0x200d)}c${cp(0xfe0f)}d${cp(0xe0067)}`)).toBe("abcd");
  });

  it("remove escritas fora do latim", () => {
    expect(sanitizeImageText("Bolo 蛋糕 Торт كعكة")).toBe("Bolo");
  });

  it("decompõe letras sem glifo para a letra base", () => {
    expect(sanitizeImageText("Ĥĥ ǎ ǅ")).toBe("Hh a Dž");
  });

  it("normaliza espaços e traços tipográficos", () => {
    expect(sanitizeImageText(`  a\t\nb${cp(0x2003)}c${cp(0x2010)}d${cp(0x2028)}e${cp(0xad)}f  `)).toBe("a b c-d e f");
  });

  it("normaliza NFD para NFC", () => {
    expect(sanitizeImageText(`Sa${cp(0x303)}o`)).toBe("São");
  });

  it("aceita só code points com glifo na Sora", () => {
    expect(isRenderableCodePoint(0x1f36a)).toBe(false);
    expect(isRenderableCodePoint(0x0124)).toBe(false);
    expect(isRenderableCodePoint(0x00ad)).toBe(false);
    expect(isRenderableCodePoint(0x0141)).toBe(true);
    expect(isRenderableCodePoint(0x0218)).toBe(true);
  });
});
