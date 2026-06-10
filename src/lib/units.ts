import { BaseUnit } from "@prisma/client";

/** Unidades aceitas no input */
export type InputUnit = "G" | "KG" | "ML" | "L" | "UN" | "TSP" | "DSP" | "TBSP";

/** Unidades padrão (sem colheres) — para compras */
export const PURCHASE_UNITS: InputUnit[] = ["G", "KG", "ML", "L", "UN"];

/** Unidades disponíveis por tipo de base — para receitas */
export function recipeUnitsFor(baseUnit: BaseUnit): InputUnit[] {
  if (baseUnit === BaseUnit.G)  return ["G", "KG", "TSP", "DSP", "TBSP"];
  if (baseUnit === BaseUnit.ML) return ["ML", "L", "TSP", "DSP", "TBSP"];
  return ["UN"];
}

export const UNIT_LABEL: Record<InputUnit, string> = {
  G:    "g",
  KG:   "kg",
  ML:   "ml",
  L:    "L",
  UN:   "un",
  TSP:  "col. chá",
  DSP:  "col. sobremesa",
  TBSP: "col. sopa",
};

export const UNIT_LABEL_SHORT: Record<InputUnit, string> = {
  G:    "g",
  KG:   "kg",
  ML:   "ml",
  L:    "L",
  UN:   "un",
  TSP:  "c.chá",
  DSP:  "c.sob.",
  TBSP: "c.sopa",
};

/**
 * ml/g por unidade de colher.
 * Para G usa gramas-equivalentes (aproximação padrão para panificação).
 * Para ML usa mililitros exatos.
 */
const SPOON_ML: Record<string, number> = { TSP: 5, DSP: 10, TBSP: 15 };

/**
 * Converte quantidade + unidade de input para a unidade base (G/ML/UN).
 * `ingredientBase` é necessário para colheres: determina se o resultado é g ou ml.
 */
export function toBaseUnit(
  quantity: number,
  unit: InputUnit,
  ingredientBase?: BaseUnit,
): { quantity: number; unit: BaseUnit } {
  switch (unit) {
    case "KG":   return { quantity: quantity * 1000, unit: BaseUnit.G };
    case "L":    return { quantity: quantity * 1000, unit: BaseUnit.ML };
    case "TSP":
    case "DSP":
    case "TBSP": {
      const ml = SPOON_ML[unit]!;
      const base = ingredientBase ?? BaseUnit.ML;
      return { quantity: quantity * ml, unit: base };
    }
    default:     return { quantity, unit: unit as BaseUnit };
  }
}

/** Converte quantidade base → valor de exibição na unidade escolhida */
export function toDisplayValue(quantity: number, inputUnit: InputUnit, ingredientBase?: BaseUnit): number {
  if (inputUnit === "KG") return quantity / 1000;
  if (inputUnit === "L")  return quantity / 1000;
  if (inputUnit === "TSP" || inputUnit === "DSP" || inputUnit === "TBSP") {
    return quantity / SPOON_ML[inputUnit]!;
  }
  return quantity;
}

/** Formata quantidade armazenada (base) na melhor unidade para exibição */
export function formatQty(quantity: number, unit: BaseUnit): string {
  if (unit === BaseUnit.G && quantity >= 1000) {
    const kg = quantity / 1000;
    return `${kg % 1 === 0 ? kg : +kg.toFixed(3)} kg`;
  }
  if (unit === BaseUnit.ML && quantity >= 1000) {
    const l = quantity / 1000;
    return `${l % 1 === 0 ? l : +l.toFixed(3)} L`;
  }
  const suffix = unit === BaseUnit.G ? "g" : unit === BaseUnit.ML ? "ml" : "un";
  return `${quantity % 1 === 0 ? quantity : +quantity.toFixed(2)} ${suffix}`;
}

/** Rótulo curto da unidade base */
export function baseUnitLabel(unit: BaseUnit): string {
  return unit === BaseUnit.G ? "g" : unit === BaseUnit.ML ? "ml" : "un";
}

/** Infere a melhor InputUnit para exibição de um valor armazenado */
export function bestInputUnit(quantity: number, unit: BaseUnit): InputUnit {
  if (unit === BaseUnit.G  && quantity >= 1000) return "KG";
  if (unit === BaseUnit.ML && quantity >= 1000) return "L";
  return unit as InputUnit;
}
