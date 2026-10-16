import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_TOUR } from "./app-tour";
import { MISSIONS, type StepTarget, type TourStepDef } from "./missions";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

const sources = sourceFiles(join(process.cwd(), "src")).map((file) => readFileSync(file, "utf8"));

function targetIds(target: StepTarget): string[] {
  return typeof target === "string" ? [target] : [target.mobile, target.desktop];
}

function declaresTarget(id: string): boolean {
  return sources.some((source) => source.includes("data-tour") && source.includes(`"${id}"`));
}

function declaresViewport(id: string): boolean {
  return sources.some((source) => source.includes(`id="${id}"`));
}

const allSteps: TourStepDef[] = [...APP_TOUR, ...Object.values(MISSIONS).flatMap((mission) => mission.steps)];

describe("roteiros do onboarding", () => {
  it("todo alvo citado existe como data-tour em algum componente", () => {
    const missing = allSteps.flatMap((step) => targetIds(step.target)).filter((id) => !declaresTarget(id));
    expect(missing).toEqual([]);
  });

  it("todo diálogo citado tem o id no DialogContent", () => {
    const viewports = [...new Set(allSteps.map((step) => step.viewport).filter((v): v is string => Boolean(v)))];
    expect(viewports.filter((id) => !declaresViewport(id))).toEqual([]);
  });
});
