import { describe, expect, it } from "vitest";
import { dueTodayNotification, saoPauloDayRange } from "./due-today";

describe("saoPauloDayRange", () => {
  it("às 7h de Brasília cobre o dia inteiro no fuso de São Paulo", () => {
    const range = saoPauloDayRange(new Date("2026-10-23T10:00:00Z"));
    expect(range.isoDate).toBe("2026-10-23");
    expect(range.start.toISOString()).toBe("2026-10-23T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-24T03:00:00.000Z");
  });

  it("perto da meia-noite UTC ainda considera o dia de Brasília", () => {
    const range = saoPauloDayRange(new Date("2026-10-24T01:30:00Z"));
    expect(range.isoDate).toBe("2026-10-23");
  });
});

describe("dueTodayNotification", () => {
  const base = { workspaceId: "ws1", workspaceName: "Doce Vida", isoDate: "2026-10-23" };

  it("usa o singular para uma cobrança", () => {
    expect(dueTodayNotification({ ...base, count: 1 }).body).toBe("1 cobrança vence hoje. Toque para cobrar.");
  });

  it("mostra a quantidade, o workspace e leva às vendas pendentes do dia", () => {
    const notification = dueTodayNotification({ ...base, count: 3 });
    expect(notification).toEqual({
      title: "Cobranças de hoje · Doce Vida",
      body: "3 cobranças vencem hoje. Toque para cobrar.",
      url: "/sales?tab=pending&pfrom=2026-10-23&pto=2026-10-23",
      tag: "due-today-ws1-2026-10-23",
    });
  });
});
