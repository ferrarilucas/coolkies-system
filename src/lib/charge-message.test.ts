import { describe, expect, it } from "vitest";
import { DEFAULT_CHARGE_TEMPLATE, firstName, formatChargeAmount, renderChargeMessage } from "./charge-message";

describe("renderChargeMessage", () => {
  it("usa o modelo padrão quando o template é null", () => {
    expect(
      renderChargeMessage({
        template: null,
        customerName: "  Maria  da Silva ",
        totalCents: 123450,
        pixKey: "maria@ex.com",
      }),
    ).toBe(
      "Oi, Maria! Tudo bem?\nPassando para lembrar do valor em aberto de R$ 1.234,50.\nPix: maria@ex.com\nQualquer dúvida, é só me chamar. Obrigado!",
    );
  });

  it("substitui {nome_completo} sem confundir com {nome}", () => {
    expect(
      renderChargeMessage({ template: "{nome} / {nome_completo}", customerName: "Ana Paula", totalCents: 0, pixKey: null }),
    ).toBe("Ana / Ana Paula");
  });

  it("remove a linha inteira com variável vazia", () => {
    expect(renderChargeMessage({ template: "a\nPix: {pix}\nb", customerName: "X", totalCents: 1, pixKey: null })).toBe("a\nb");
    expect(renderChargeMessage({ template: "a\nPix: {pix}\nb", customerName: "X", totalCents: 1, pixKey: "  " })).toBe("a\nb");
  });

  it("mantém variável desconhecida", () => {
    expect(renderChargeMessage({ template: "até {data}", customerName: "X", totalCents: 1, pixKey: null })).toBe("até {data}");
  });

  it("template vazio cai no padrão", () => {
    expect(renderChargeMessage({ template: "   ", customerName: "X", totalCents: 1, pixKey: null })).toContain("Oi, X!");
  });

  it("substitui todas as ocorrências", () => {
    expect(renderChargeMessage({ template: "{nome} {nome}", customerName: "Bia", totalCents: 1, pixKey: null })).toBe("Bia Bia");
  });

  it("não usa espaço não separável no valor", () => {
    expect(renderChargeMessage({ template: "{valor}", customerName: "X", totalCents: 500, pixKey: null })).toBe("R$ 5,00");
  });

  it("não reprocessa valores já inseridos", () => {
    expect(
      renderChargeMessage({
        template: "Oi {nome_completo}\nNome {nome}",
        customerName: "{pix} {valor}",
        totalCents: 500,
        pixKey: "a@b.c",
      }),
    ).toBe("Oi {pix} {valor}\nNome {pix}");
    expect(
      renderChargeMessage({ template: "Oi {nome_completo}", customerName: "Loja {pix}", totalCents: 1, pixKey: "a@b.c" }),
    ).toBe("Oi Loja {pix}");
  });

  it("remove a linha com {nome} quando o nome é só espaço", () => {
    expect(renderChargeMessage({ template: "a\nOi, {nome}!\nb", customerName: "  ", totalCents: 1, pixKey: null })).toBe("a\nb");
  });

  it("troca espaço não separável e estreito do valor por espaço comum", () => {
    expect(formatChargeAmount(500)).not.toMatch(/[\u00A0\u202F]/);
  });

  it("mantém linhas em branco do modelo", () => {
    expect(renderChargeMessage({ template: "a\n\nb", customerName: "X", totalCents: 1, pixKey: null })).toBe("a\n\nb");
  });
});

describe("firstName", () => {
  it("pega a primeira palavra", () => {
    expect(firstName("  João   Pedro ")).toBe("João");
  });
});

describe("DEFAULT_CHARGE_TEMPLATE", () => {
  it("tem as quatro linhas do spec", () => {
    expect(DEFAULT_CHARGE_TEMPLATE.split("\n")).toHaveLength(4);
  });
});
