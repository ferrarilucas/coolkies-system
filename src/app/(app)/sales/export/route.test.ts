import { describe, expect, it } from "vitest";
import { parseDateParam } from "./route";

describe("parseDateParam", () => {
  it("retorna undefined quando o parâmetro não foi informado", () => {
    expect(parseDateParam(null)).toBeUndefined();
  });

  it("retorna a data quando o parâmetro é uma data válida", () => {
    const result = parseDateParam("2026-01-15");
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN((result as Date).getTime())).toBe(false);
  });

  it("retorna null quando o parâmetro é uma data malformada", () => {
    expect(parseDateParam("garbage")).toBeNull();
  });

  it("retorna null quando o parâmetro é uma string vazia após trim implícito de espaços", () => {
    expect(parseDateParam("   ")).toBeNull();
  });
});
