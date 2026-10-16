import type { Model, SectorExamples } from "./sectors";
import type { Side, StepTarget, TourStepDef } from "./missions";
import { fillText } from "./text";

export type Viewport = "mobile" | "desktop";

export type BuiltStep = {
  def: TourStepDef;
  selector: string;
  side: Side;
  title: string;
  content: string;
};

export type BuildContext = {
  model: Model | null;
  viewport: Viewport;
  examples: SectorExamples;
  missionsVisible: boolean;
};

export function resolve<T extends string>(value: T | { mobile: T; desktop: T }, viewport: Viewport): T {
  return typeof value === "string" ? value : value[viewport];
}

export function selectorFor(target: StepTarget, viewport: Viewport): string {
  return `[data-tour="${resolve(target, viewport)}"]`;
}

export function buildSteps(defs: TourStepDef[], context: BuildContext): BuiltStep[] {
  return defs
    .filter((def) => !def.models || (context.model !== null && def.models.includes(context.model)))
    .filter((def) => !def.requiresMissions || context.missionsVisible)
    .map((def) => ({
      def,
      selector: selectorFor(def.target, context.viewport),
      side: resolve(def.side, context.viewport),
      title: fillText(def.title, context.examples),
      content: fillText(def.content, context.examples),
    }));
}

export function stepIndexById(steps: BuiltStep[], id: string): number {
  return steps.findIndex((step) => step.def.id === id);
}

export function fallbackIndexBefore(steps: BuiltStep[], index: number): number {
  for (let position = Math.min(index, steps.length) - 1; position >= 0; position -= 1) {
    if (!steps[position].def.viewport) return position;
  }
  return -1;
}

export function usesSpotlight(step: BuiltStep): boolean {
  return !step.def.viewport && step.def.advance.on !== "await";
}
