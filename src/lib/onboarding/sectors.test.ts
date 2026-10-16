import { describe, expect, it } from "vitest";
import { SECTORS, SECTOR_KEYS, getSector, isSectorKey, modelOf } from "./sectors";

describe("setores", () => {
  it("tem exatamente as chaves da lista, sem repetição", () => {
    expect(SECTORS.map((s) => s.key)).toEqual([...SECTOR_KEYS]);
  });

  it("mapeia cada setor para o modelo de operação da spec", () => {
    expect(Object.fromEntries(SECTORS.map((s) => [s.key, s.model]))).toEqual({
      confeitaria: "PRODUZ",
      salgados: "PRODUZ",
      cosmeticos: "PRODUZ",
      roupas: "REVENDE",
      papelaria: "REVENDE",
      revenda: "REVENDE",
      artesanato: "SOB_ENCOMENDA",
      marcenaria: "SOB_ENCOMENDA",
      costura: "SOB_ENCOMENDA",
      outro: "GENERICO",
    });
  });

  it("dá dois eixos com pelo menos duas opções a todo setor", () => {
    for (const sector of SECTORS) {
      expect(sector.examples.eixos).toHaveLength(2);
      for (const eixo of sector.examples.eixos) {
        expect(eixo.opcoes.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("dá exemplo de insumo a quem produz", () => {
    for (const sector of SECTORS.filter((s) => s.model === "PRODUZ" || s.model === "SOB_ENCOMENDA")) {
      expect(sector.examples.insumo).toBeTruthy();
    }
  });

  it("usa os exemplos combinados para confeitaria e roupas", () => {
    expect(getSector("confeitaria").examples).toMatchObject({
      produto: "Bolo de pote",
      insumo: "Farinha de trigo",
      eixos: [
        { nome: "Sabor", opcoes: ["Ninho", "Nutella", "Doce de leite"] },
        { nome: "Tamanho", opcoes: ["Mini", "Tradicional"] },
      ],
    });
    expect(getSector("roupas").examples).toMatchObject({
      produto: "Camiseta",
      insumo: null,
      eixos: [
        { nome: "Tamanho", opcoes: ["P", "M", "G"] },
        { nome: "Cor", opcoes: ["Azul", "Verde"] },
      ],
    });
  });

  it("aceita só chaves conhecidas", () => {
    expect(isSectorKey("confeitaria")).toBe(true);
    expect(isSectorKey("padaria")).toBe(false);
    expect(isSectorKey("")).toBe(false);
    expect(isSectorKey(null)).toBe(false);
    expect(isSectorKey(42)).toBe(false);
  });

  it("devolve o modelo pela chave", () => {
    expect(modelOf("marcenaria")).toBe("SOB_ENCOMENDA");
  });
});
