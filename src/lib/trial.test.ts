import { describe, expect, it } from "vitest";
import { daysUntil, isTrialExpired, trialState } from "./trial";

describe("contagem de dias do trial", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("conta dias inteiros que faltam", () => {
    expect(daysUntil(new Date("2026-09-15T12:00:00Z"), now)).toBe(14);
    expect(daysUntil(new Date("2026-09-02T12:00:00Z"), now)).toBe(1);
  });

  it("arredonda para cima quando sobra parte do dia", () => {
    expect(daysUntil(new Date("2026-09-02T06:00:00Z"), now)).toBe(1);
  });

  it("hoje e o ultimo dia vale zero", () => {
    expect(daysUntil(new Date("2026-09-01T20:00:00Z"), now)).toBe(0);
  });

  it("data passada vale zero, nao negativo", () => {
    expect(daysUntil(new Date("2026-08-20T12:00:00Z"), now)).toBe(0);
  });

  it("sem data devolve null", () => {
    expect(daysUntil(null, now)).toBeNull();
  });

  it("compara os dias no fuso de Brasilia, nao em UTC", () => {
    const nightInBrasilia = new Date("2026-09-02T00:30:00Z");
    const nextNightInBrasilia = new Date("2026-09-02T22:00:00Z");
    expect(daysUntil(nextNightInBrasilia, nightInBrasilia)).toBe(1);
  });
});

describe("estado do trial", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("trial em andamento devolve os dias que faltam", () => {
    expect(trialState("TRIALING", new Date("2026-09-05T12:00:00Z"), now)).toEqual({
      kind: "running",
      daysLeft: 4,
    });
  });

  it("ultimo dia ainda e trial em andamento, nao vencido", () => {
    const state = trialState("TRIALING", new Date("2026-09-01T23:00:00Z"), now);
    expect(state).toEqual({ kind: "running", daysLeft: 0 });
    expect(isTrialExpired("TRIALING", new Date("2026-09-01T23:00:00Z"), now)).toBe(false);
  });

  it("trial vencido e um estado proprio, nao dias restantes zerados", () => {
    expect(trialState("TRIALING", new Date("2026-08-20T12:00:00Z"), now)).toEqual({
      kind: "expired",
    });
    expect(isTrialExpired("TRIALING", new Date("2026-08-20T12:00:00Z"), now)).toBe(true);
  });

  it("quem nao esta em teste nao tem estado de trial", () => {
    expect(trialState("ACTIVE", new Date("2026-08-20T12:00:00Z"), now)).toBeNull();
    expect(trialState("PAST_DUE", new Date("2026-08-20T12:00:00Z"), now)).toBeNull();
    expect(trialState("CANCELED", new Date("2026-08-20T12:00:00Z"), now)).toBeNull();
    expect(trialState("NONE", null, now)).toBeNull();
    expect(isTrialExpired("CANCELED", new Date("2026-08-20T12:00:00Z"), now)).toBe(false);
  });

  it("trial sem data de fim nao vence", () => {
    expect(trialState("TRIALING", null, now)).toBeNull();
    expect(isTrialExpired("TRIALING", null, now)).toBe(false);
  });
});
