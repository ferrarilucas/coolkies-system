import { describe, expect, it } from "vitest";
import { MISSION_IDS, type OnboardingProgress } from "./missions";
import {
  allMissionsDone,
  canPreviewMissions,
  canSeeMissions,
  missionCounts,
  newlyCompleted,
  nextMission,
  shouldShowAppTour,
  shouldShowMissions,
  shouldShowSectorPrompt,
  type OnboardingState,
} from "./visibility";

function progress(done: string[] = []): OnboardingProgress {
  return Object.fromEntries(MISSION_IDS.map((id) => [id, done.includes(id)])) as OnboardingProgress;
}

function state(patch: Partial<OnboardingState> = {}): OnboardingState {
  return {
    workspaceId: "w1",
    sector: "roupas",
    dismissed: false,
    appTourDone: true,
    eligible: true,
    progress: progress(),
    ...patch,
  };
}

describe("canSeeMissions", () => {
  it("libera dono e admin com escrita", () => {
    expect(canSeeMissions("OWNER", true)).toBe(true);
    expect(canSeeMissions("ADMIN", true)).toBe(true);
  });

  it("bloqueia membro e workspace em modo leitura", () => {
    expect(canSeeMissions("MEMBER", true)).toBe(false);
    expect(canSeeMissions("OWNER", false)).toBe(false);
  });
});

describe("shouldShowMissions", () => {
  it("só mostra depois do tour, ou durante ele", () => {
    expect(shouldShowMissions(state({ appTourDone: false }), false)).toBe(false);
    expect(shouldShowMissions(state({ appTourDone: false }), true)).toBe(true);
    expect(shouldShowMissions(state(), false)).toBe(true);
  });

  it("esconde quando dispensado, sem setor, sem progresso ou tudo feito", () => {
    expect(shouldShowMissions(state({ dismissed: true }), false)).toBe(false);
    expect(shouldShowMissions(state({ sector: null }), false)).toBe(false);
    expect(shouldShowMissions(state({ progress: null }), false)).toBe(false);
    expect(shouldShowMissions(state({ progress: progress(["catalogo", "compra-fornecedor", "venda", "cliente"]) }), false)).toBe(false);
  });

  it("deixa pré-visualizar mesmo antes do tour", () => {
    expect(canPreviewMissions(state({ appTourDone: false }))).toBe(true);
  });
});

describe("nextMission e missionCounts", () => {
  it("pega a primeira pendente na ordem do modelo", () => {
    expect(nextMission(state())?.id).toBe("catalogo");
    expect(nextMission(state({ progress: progress(["catalogo"]) }))?.id).toBe("compra-fornecedor");
    expect(nextMission(state({ progress: progress(["catalogo", "venda"]) }))?.id).toBe("compra-fornecedor");
  });

  it("conta só as missões do modelo", () => {
    expect(missionCounts(state({ progress: progress(["catalogo", "compra-insumo"]) }))).toEqual({ done: 1, total: 4 });
    expect(missionCounts(state({ progress: null }))).toEqual({ done: 0, total: 4 });
  });
});

describe("shouldShowSectorPrompt", () => {
  it("convida workspace antigo sem setor depois do tour", () => {
    expect(shouldShowSectorPrompt(state({ sector: null, progress: null }))).toBe(true);
    expect(shouldShowSectorPrompt(state({ sector: null, progress: null, dismissed: true }))).toBe(false);
    expect(shouldShowSectorPrompt(state({ sector: null, progress: null, eligible: false }))).toBe(false);
    expect(shouldShowSectorPrompt(state({ sector: null, progress: null, appTourDone: false }))).toBe(false);
  });
});

describe("tour, novidades e conclusão", () => {
  it("mostra o tour enquanto não foi feito", () => {
    expect(shouldShowAppTour(state({ appTourDone: false }))).toBe(true);
    expect(shouldShowAppTour(state())).toBe(false);
  });

  it("aponta só as missões que acabaram de ser concluídas", () => {
    expect(newlyCompleted(progress(), progress(["venda"]))).toEqual(["venda"]);
    expect(newlyCompleted(progress(["venda"]), progress(["venda"]))).toEqual([]);
    expect(newlyCompleted(null, progress(["venda"]))).toEqual([]);
  });

  it("detecta quando tudo do modelo foi feito", () => {
    expect(allMissionsDone(state({ progress: progress(["catalogo", "compra-fornecedor", "venda", "cliente"]) }))).toBe(true);
    expect(allMissionsDone(state())).toBe(false);
    expect(allMissionsDone(state({ progress: null }))).toBe(false);
  });
});
