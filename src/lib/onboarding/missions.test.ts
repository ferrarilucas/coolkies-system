import { describe, expect, it } from "vitest";
import { MISSIONS, MISSION_IDS, MISSION_ORDER, isRouteOfMission } from "./missions";

describe("missões", () => {
  it("segue a ordem da spec para cada modelo", () => {
    expect(MISSION_ORDER).toEqual({
      PRODUZ: ["compra-insumo", "ficha-tecnica", "catalogo", "producao", "venda", "cliente"],
      REVENDE: ["catalogo", "compra-fornecedor", "venda", "cliente"],
      SOB_ENCOMENDA: ["compra-insumo", "catalogo", "cliente", "venda-parcelada"],
      GENERICO: ["catalogo", "venda", "cliente"],
    });
  });

  it("define todas as missões com id coerente", () => {
    for (const id of MISSION_IDS) expect(MISSIONS[id].id).toBe(id);
  });

  it("tem passos com ids únicos, saltos válidos e um passo final de clique", () => {
    for (const mission of Object.values(MISSIONS)) {
      const ids = mission.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const step of mission.steps) {
        if (step.skip) expect(ids).toContain(step.skip.to);
      }
      const last = mission.steps[mission.steps.length - 1];
      expect(last.advance).toEqual({ on: "click", final: true });
    }
  });

  it("começa cada missão numa rota da própria missão", () => {
    for (const mission of Object.values(MISSIONS)) {
      expect(isRouteOfMission(mission.startRoute, mission)).toBe(true);
    }
  });

  it("reconhece subrotas e rejeita prefixos parecidos", () => {
    expect(isRouteOfMission("/sales/new", MISSIONS.venda)).toBe(true);
    expect(isRouteOfMission("/sales", MISSIONS.venda)).toBe(true);
    expect(isRouteOfMission("/salesx", MISSIONS.venda)).toBe(false);
    expect(isRouteOfMission("/dashboard", MISSIONS.venda)).toBe(false);
  });

  it("abre o guia de variações só na missão do catálogo", () => {
    const withIntro = Object.values(MISSIONS).filter((m) => m.intro).map((m) => m.id);
    expect(withIntro).toEqual(["catalogo"]);
  });
});
