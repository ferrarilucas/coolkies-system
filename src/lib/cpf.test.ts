import { describe, expect, it } from "vitest";
import { isCompleteCpf, maskCpf, onlyDigits } from "./cpf";

describe("onlyDigits", () => {
  it("remove tudo que não é dígito", () => {
    expect(onlyDigits("123.456.789-09")).toBe("12345678909");
  });
});

describe("maskCpf", () => {
  it("formata um CPF completo", () => {
    expect(maskCpf("12345678909")).toBe("123.456.789-09");
  });

  it("formata parcialmente enquanto o usuário digita", () => {
    expect(maskCpf("123456")).toBe("123.456");
  });

  it("ignora dígitos além dos 11", () => {
    expect(maskCpf("123456789091234")).toBe("123.456.789-09");
  });
});

describe("isCompleteCpf", () => {
  it("aceita 11 dígitos", () => {
    expect(isCompleteCpf("123.456.789-09")).toBe(true);
  });

  it("recusa menos de 11 dígitos", () => {
    expect(isCompleteCpf("123.456.789")).toBe(false);
  });
});
