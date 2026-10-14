import { describe, expect, it } from "vitest";
import { BaseUnit } from "@prisma/client";
import { convertPriceMode, lineTotalCents } from "./purchase-price";
import { formatUnitPrice } from "./units";

describe("lineTotalCents", () => {
  it("valor total é usado como está, independente da quantidade", () => {
    expect(lineTotalCents("TOTAL", 600, 180)).toBe(600);
  });

  it("preço por unidade multiplica pela quantidade", () => {
    expect(lineTotalCents("UNIT", 500, 2.5)).toBe(1250);
  });

  it("preço por unidade sem quantidade dá zero", () => {
    expect(lineTotalCents("UNIT", 500, 0)).toBe(0);
    expect(lineTotalCents("UNIT", 500, NaN)).toBe(0);
  });
});

describe("convertPriceMode", () => {
  it("unitário → total preserva o total", () => {
    expect(convertPriceMode("UNIT", "TOTAL", 500, 2)).toBe(1000);
  });

  it("total → unitário divide pela quantidade", () => {
    expect(convertPriceMode("TOTAL", "UNIT", 1000, 4)).toBe(250);
  });

  it("total → unitário sem quantidade zera", () => {
    expect(convertPriceMode("TOTAL", "UNIT", 1000, 0)).toBe(0);
  });
});

describe("formatUnitPrice", () => {
  it("gramas mostram por kg", () => {
    expect(formatUnitPrice(600, 180, BaseUnit.G)).toMatch(/33,33\/kg$/);
  });

  it("ml mostram por L", () => {
    expect(formatUnitPrice(500, 1000, BaseUnit.ML)).toMatch(/5,00\/L$/);
  });

  it("unidades mostram por un", () => {
    expect(formatUnitPrice(700, 29, BaseUnit.UN)).toMatch(/0,24\/un$/);
  });

  it("sem quantidade mostra traço", () => {
    expect(formatUnitPrice(700, 0, BaseUnit.UN)).toBe("—");
  });
});
