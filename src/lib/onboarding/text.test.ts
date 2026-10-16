import { describe, expect, it } from "vitest";
import { getSector } from "./sectors";
import { fillText, joinOptions } from "./text";

describe("joinOptions", () => {
  it("junta com vírgula e 'e' no fim", () => {
    expect(joinOptions(["P", "M", "G"])).toBe("P, M e G");
    expect(joinOptions(["Mini", "Tradicional"])).toBe("Mini e Tradicional");
    expect(joinOptions(["Único"])).toBe("Único");
    expect(joinOptions([])).toBe("");
  });
});

describe("fillText", () => {
  const confeitaria = getSector("confeitaria").examples;
  const roupas = getSector("roupas").examples;

  it("troca os marcadores pelos exemplos do setor", () => {
    expect(fillText("Digite {produto}. Tipo: {eixo} ({opcoes}) e {eixo2} ({opcoes2}).", confeitaria)).toBe(
      "Digite Bolo de pote. Tipo: Sabor (Ninho, Nutella e Doce de leite) e Tamanho (Mini e Tradicional).",
    );
  });

  it("usa um texto neutro quando o setor não tem insumo", () => {
    expect(fillText("Compre {insumo}", roupas)).toBe("Compre o insumo");
  });

  it("mantém marcadores desconhecidos", () => {
    expect(fillText("Olá {ninguem}", roupas)).toBe("Olá {ninguem}");
  });
});
