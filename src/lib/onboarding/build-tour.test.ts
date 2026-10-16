import { describe, expect, it } from "vitest";
import { APP_TOUR } from "./app-tour";
import { buildSteps, fallbackIndexBefore, selectorFor, stepIndexById, usesSpotlight } from "./build-tour";
import { MISSIONS } from "./missions";
import { getSector } from "./sectors";

const confeitaria = getSector("confeitaria").examples;
const roupas = getSector("roupas").examples;

describe("buildSteps", () => {
  it("inclui a ficha técnica da combinação só para quem produz", () => {
    const produz = buildSteps(MISSIONS.catalogo.steps, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    const revende = buildSteps(MISSIONS.catalogo.steps, { model: "REVENDE", viewport: "mobile", examples: roupas, missionsVisible: true });
    expect(produz.map((s) => s.def.id)).toContain("ficha-combinacao");
    expect(revende.map((s) => s.def.id)).not.toContain("ficha-combinacao");
  });

  it("resolve o alvo e o lado pelo tamanho de tela", () => {
    const mobile = buildSteps(APP_TOUR, { model: null, viewport: "mobile", examples: roupas, missionsVisible: false });
    const desktop = buildSteps(APP_TOUR, { model: null, viewport: "desktop", examples: roupas, missionsVisible: false });
    const vender = (steps: typeof mobile) => steps.find((s) => s.def.id === "vender")!;
    expect(vender(mobile).selector).toBe('[data-tour="nav-sell"]');
    expect(vender(desktop).selector).toBe('[data-tour="dashboard-new-sale"]');
    expect(mobile.find((s) => s.def.id === "vendas")!.side).toBe("top");
    expect(desktop.find((s) => s.def.id === "vendas")!.side).toBe("right");
  });

  it("tira a parada do card de missões quando elas não estão visíveis", () => {
    const sem = buildSteps(APP_TOUR, { model: null, viewport: "mobile", examples: roupas, missionsVisible: false });
    const com = buildSteps(APP_TOUR, { model: "REVENDE", viewport: "mobile", examples: roupas, missionsVisible: true });
    expect(sem.map((s) => s.def.id)).not.toContain("primeiros-passos");
    expect(com.map((s) => s.def.id)).toContain("primeiros-passos");
  });

  it("preenche os textos com os exemplos do setor", () => {
    const steps = buildSteps(MISSIONS.catalogo.steps, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    expect(steps[0].content).toBe("Digite o nome, por exemplo Bolo de pote.");
    const tour = buildSteps(APP_TOUR, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    expect(tour[0].title).toBe("Boas-vindas à sua confeitaria!");
  });

  it("usa holofote só fora de diálogos e de passos de espera", () => {
    const compra = buildSteps(MISSIONS["compra-insumo"].steps, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    expect(usesSpotlight(compra[0])).toBe(true);
    expect(compra.slice(1).every((s) => !usesSpotlight(s))).toBe(true);
    const producao = buildSteps(MISSIONS.producao.steps, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });
    expect(usesSpotlight(producao[0])).toBe(false);
  });

  it("acha o índice de um passo pelo id", () => {
    const steps = buildSteps(MISSIONS.catalogo.steps, { model: "REVENDE", viewport: "mobile", examples: roupas, missionsVisible: true });
    expect(steps[stepIndexById(steps, "salvar")].def.id).toBe("salvar");
    expect(stepIndexById(steps, "nao-existe")).toBe(-1);
  });
});

describe("selectorFor", () => {
  it("monta o seletor de atributo", () => {
    expect(selectorFor("product-name", "mobile")).toBe('[data-tour="product-name"]');
    expect(selectorFor({ mobile: "a", desktop: "b" }, "desktop")).toBe('[data-tour="b"]');
  });
});

describe("fallbackIndexBefore", () => {
  const steps = buildSteps(MISSIONS["compra-insumo"].steps, { model: "PRODUZ", viewport: "mobile", examples: confeitaria, missionsVisible: true });

  it("volta ao último passo sem diálogo antes do atual", () => {
    const salvar = stepIndexById(steps, "salvar");
    const abrir = stepIndexById(steps, "abrir");
    expect(steps[salvar].def.viewport).toBeTruthy();
    expect(fallbackIndexBefore(steps, salvar)).toBe(abrir);
  });

  it("devolve -1 quando não há passo anterior sem diálogo", () => {
    expect(fallbackIndexBefore(steps, 0)).toBe(-1);
  });
});
