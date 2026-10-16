import { describe, expect, it } from "vitest";
import { DEFAULT_GUIDE_EXAMPLE, guideCombos, guidePricingRows } from "./guide-example";
import { getSector } from "./sectors";

describe("guia de variações", () => {
  it("mantém o exemplo atual do Brownie como padrão", () => {
    expect(guideCombos(DEFAULT_GUIDE_EXAMPLE)).toEqual([
      { name: "Nutella · Mini", on: true },
      { name: "Nutella · Tradicional", on: true },
      { name: "Doce de leite · Mini", on: true },
      { name: "Doce de leite · Tradicional", on: true },
      { name: "Ninho · Mini", on: false },
      { name: "Ninho · Tradicional", on: true },
    ]);
    expect(guidePricingRows(DEFAULT_GUIDE_EXAMPLE)).toEqual([
      { name: "Nutella · Tradicional", price: "R$ 14,00" },
      { name: "Nutella · Mini", price: "R$ 0,00", usesDefault: true },
      { name: "Ninho · Tradicional", price: "R$ 15,00", pauses: true },
    ]);
  });

  it("monta as combinações com os eixos do setor", () => {
    const roupas = getSector("roupas").examples;
    const combos = guideCombos(roupas);
    expect(combos.map((c) => c.name)).toEqual(["P · Azul", "P · Verde", "M · Azul", "M · Verde", "G · Azul", "G · Verde"]);
    expect(combos.filter((c) => !c.on).map((c) => c.name)).toEqual(["G · Azul"]);
    expect(guidePricingRows(roupas).map((r) => r.name)).toEqual(["P · Verde", "P · Azul", "G · Verde"]);
  });
});
