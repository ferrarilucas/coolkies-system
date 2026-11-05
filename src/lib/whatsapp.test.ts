import { describe, expect, it } from "vitest";
import { normalizeBrPhone, whatsappUrl } from "./whatsapp";

describe("normalizeBrPhone", () => {
  it.each([
    ["(55) 99123-4567", "5555991234567"],
    ["11 98765-4321", "5511987654321"],
    ["(11) 3456-7890", "551134567890"],
    ["+55 11 98765-4321", "5511987654321"],
    ["5555991234567", "5555991234567"],
    ["5511987654321", "5511987654321"],
    ["011987654321", null],
    ["55119876543210", null],
    ["123", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("%s → %s", (raw, expected) => expect(normalizeBrPhone(raw)).toBe(expected));
});

describe("whatsappUrl", () => {
  it("com telefone", () => {
    expect(whatsappUrl("Oi & tchau", "11987654321")).toBe("https://wa.me/5511987654321?text=Oi%20%26%20tchau");
  });

  it("sem telefone válido", () => {
    expect(whatsappUrl("Oi", "12")).toBe("https://wa.me/?text=Oi");
  });

  it("codifica quebra de linha", () => {
    expect(whatsappUrl("a\nb")).toBe("https://wa.me/?text=a%0Ab");
  });
});
