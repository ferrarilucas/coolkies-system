import { describe, expect, it } from "vitest";
import { daysUntil } from "./trial";

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
});
