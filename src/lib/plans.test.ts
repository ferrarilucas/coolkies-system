import { describe, expect, it } from "vitest";
import { effectiveLimit, planLimit, planPriceCents } from "./plans";

describe("planos", () => {
  it("define o limite de workspaces por plano", () => {
    expect(planLimit("solo")).toBe(1);
    expect(planLimit("team")).toBe(4);
    expect(planLimit("unlimited")).toBe(Number.POSITIVE_INFINITY);
  });

  it("plano desconhecido cai no mais restritivo", () => {
    expect(planLimit("inexistente")).toBe(1);
  });

  it("guarda os preços em centavos", () => {
    expect(planPriceCents("solo", "MONTHLY")).toBe(2990);
    expect(planPriceCents("solo", "YEARLY")).toBe(1990);
    expect(planPriceCents("team", "MONTHLY")).toBe(9990);
    expect(planPriceCents("team", "YEARLY")).toBe(8990);
  });

  it("plano ilimitado nao tem preco de checkout", () => {
    expect(planPriceCents("unlimited", "MONTHLY")).toBeNull();
  });

  it("durante o trial o limite e sempre 1, qualquer que seja o plano", () => {
    expect(effectiveLimit("solo", "TRIALING")).toBe(1);
    expect(effectiveLimit("team", "TRIALING")).toBe(1);
    expect(effectiveLimit("unlimited", "TRIALING")).toBe(1);
  });

  it("fora do trial vale o limite do plano", () => {
    expect(effectiveLimit("team", "ACTIVE")).toBe(4);
    expect(effectiveLimit("unlimited", "ACTIVE")).toBe(Number.POSITIVE_INFINITY);
  });
});
