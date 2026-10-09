import { describe, expect, it } from "vitest";
import {
  allCombinations,
  combinationKey,
  combinationName,
  findVariantByValues,
  isValueAvailable,
  rebaseCombinations,
  resolveCombination,
  validateOptions,
  type OptionInput,
} from "./variant-options";

const tamanho: OptionInput = {
  id: null,
  name: "Tamanho",
  values: [
    { key: "p", id: null, name: "P" },
    { key: "m", id: null, name: "M" },
  ],
};
const cor: OptionInput = {
  id: null,
  name: "Cor",
  values: [
    { key: "azul", id: null, name: "Azul" },
    { key: "verde", id: null, name: "Verde" },
  ],
};

describe("validateOptions", () => {
  it("normaliza nomes e aceita até 3 eixos", () => {
    const result = validateOptions([
      { ...tamanho, name: "  tamanho " },
      { ...cor, values: [{ key: "azul", id: null, name: " azul  claro " }] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options[0].name).toBe("Tamanho");
    expect(result.options[1].values[0].name).toBe("Azul claro");
  });

  it("recusa mais de 3 eixos", () => {
    const extra = (name: string): OptionInput => ({ id: null, name, values: [{ key: name, id: null, name: "X" }] });
    const result = validateOptions([tamanho, cor, extra("Material"), extra("Gola")]);
    expect(result).toEqual({ ok: false, error: "Um produto pode ter no máximo 3 tipos de variação." });
  });

  it("recusa eixo sem nome, eixo repetido e eixo sem valores", () => {
    expect(validateOptions([{ ...tamanho, name: " " }])).toEqual({ ok: false, error: "Dê um nome a cada tipo de variação, como Sabor ou Tamanho." });
    expect(validateOptions([tamanho, { ...cor, name: "tamanho" }])).toEqual({
      ok: false,
      error: 'O tipo de variação "Tamanho" está repetido.',
    });
    expect(validateOptions([{ ...tamanho, values: [] }])).toEqual({
      ok: false,
      error: 'Adicione pelo menos uma opção em "Tamanho".',
    });
  });

  it("recusa valor repetido dentro do mesmo eixo, ignorando maiúsculas", () => {
    const result = validateOptions([
      { ...cor, values: [{ key: "a", id: null, name: "Azul" }, { key: "b", id: null, name: "azul" }] },
    ]);
    expect(result).toEqual({ ok: false, error: 'A opção "Azul" está repetida em "Cor".' });
  });

  it("descarta valores em branco", () => {
    const result = validateOptions([{ ...cor, values: [...cor.values, { key: "x", id: null, name: "  " }] }]);
    expect(result.ok && result.options[0].values).toHaveLength(2);
  });
});

describe("resolveCombination", () => {
  it("devolve um valor por eixo, na ordem dos eixos", () => {
    expect(resolveCombination([tamanho, cor], ["azul", "m"])).toEqual({ ok: true, valueKeys: ["m", "azul"] });
  });

  it("recusa combinação sem valor para algum eixo", () => {
    expect(resolveCombination([tamanho, cor], ["m"])).toEqual({
      ok: false,
      error: 'Escolha uma opção de "Cor" para cada combinação.',
    });
  });

  it("recusa combinação com dois valores do mesmo eixo ou valor desconhecido", () => {
    expect(resolveCombination([tamanho, cor], ["p", "m", "azul"]).ok).toBe(false);
    expect(resolveCombination([tamanho, cor], ["m", "roxo"]).ok).toBe(false);
  });
});

describe("combinationName", () => {
  it("junta os valores na ordem dos eixos", () => {
    expect(combinationName([tamanho, cor], ["m", "azul"])).toBe("M / Azul");
  });

  it("com um eixo só, é o próprio valor", () => {
    expect(combinationName([cor], ["verde"])).toBe("Verde");
  });
});

describe("allCombinations", () => {
  it("gera o produto cartesiano na ordem dos eixos e dos valores", () => {
    expect(allCombinations([tamanho, cor])).toEqual([
      ["p", "azul"],
      ["p", "verde"],
      ["m", "azul"],
      ["m", "verde"],
    ]);
  });

  it("sem eixos, não há combinações", () => {
    expect(allCombinations([])).toEqual([]);
  });
});

describe("rebaseCombinations", () => {
  const prev = [
    { ...tamanho, key: "tam" },
    { ...cor, key: "cor" },
  ];

  it("tira a combinação cujo valor foi apagado", () => {
    const next = [prev[0], { ...prev[1], values: [cor.values[0]] }];
    const result = rebaseCombinations(prev, next, [
      { id: "1", valueKeys: ["p", "azul"] },
      { id: "2", valueKeys: ["p", "verde"] },
    ]);
    expect(result.map((r) => r.id)).toEqual(["1"]);
  });

  it("eixo novo dá o primeiro valor às combinações existentes e marca para conferir", () => {
    const material = { key: "mat", id: null, name: "Material", values: [{ key: "alg", id: null, name: "Algodão" }] };
    const result = rebaseCombinations(prev, [...prev, material], [{ id: "1", valueKeys: ["p", "azul"] }]);
    expect(result).toEqual([{ id: "1", valueKeys: ["p", "azul", "alg"], needsReview: true }]);
  });

  it("eixo novo ainda sem valores não mexe nas combinações", () => {
    const vazio = { key: "mat", id: null, name: "Material", values: [] };
    const result = rebaseCombinations(prev, [...prev, vazio], [{ id: "1", valueKeys: ["p", "azul"] }]);
    expect(result).toEqual([{ id: "1", valueKeys: ["p", "azul"] }]);
  });

  it("remover um eixo funde as combinações que ficam iguais, mantendo a primeira", () => {
    const result = rebaseCombinations(prev, [prev[0]], [
      { id: "1", valueKeys: ["p", "azul"] },
      { id: "2", valueKeys: ["p", "verde"] },
      { id: "3", valueKeys: ["m", "verde"] },
    ]);
    expect(result).toEqual([
      { id: "1", valueKeys: ["p"] },
      { id: "3", valueKeys: ["m"] },
    ]);
  });

  it("segue a ordem nova dos eixos", () => {
    const result = rebaseCombinations(prev, [prev[1], prev[0]], [{ id: "1", valueKeys: ["p", "azul"] }]);
    expect(result).toEqual([{ id: "1", valueKeys: ["azul", "p"] }]);
  });
});

describe("combinationKey", () => {
  it("independe da ordem dos valores", () => {
    expect(combinationKey(["azul", "p"])).toBe(combinationKey(["p", "azul"]));
  });
});

describe("seleção por eixo na venda", () => {
  const variants = [
    { id: "pa", valueIds: ["p", "azul"] },
    { id: "ma", valueIds: ["m", "azul"] },
    { id: "mv", valueIds: ["m", "verde"] },
  ];

  it("acha a combinação quando todos os eixos estão escolhidos", () => {
    expect(findVariantByValues(variants, { tam: "m", cor: "verde" }, 2)?.id).toBe("mv");
  });

  it("não acha nada com escolha incompleta ou inexistente", () => {
    expect(findVariantByValues(variants, { tam: "m" }, 2)).toBeNull();
    expect(findVariantByValues(variants, { tam: "p", cor: "verde" }, 2)).toBeNull();
  });

  it("valor fica indisponível quando não combina com o que já foi escolhido nos outros eixos", () => {
    expect(isValueAvailable(variants, { tam: "p" }, "cor", "verde")).toBe(false);
    expect(isValueAvailable(variants, { tam: "p" }, "cor", "azul")).toBe(true);
    expect(isValueAvailable(variants, { tam: "p" }, "tam", "m")).toBe(true);
  });
});
