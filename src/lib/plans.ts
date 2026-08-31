export type PlanCycle = "MONTHLY" | "YEARLY";

type PlanDefinition = {
  id: string;
  label: string;
  maxWorkspaces: number;
  priceCents: Record<PlanCycle, number> | null;
};

export const PLANS: PlanDefinition[] = [
  {
    id: "solo",
    label: "1 workspace",
    maxWorkspaces: 1,
    priceCents: { MONTHLY: 2990, YEARLY: 1990 },
  },
  {
    id: "team",
    label: "Até 4 workspaces",
    maxWorkspaces: 4,
    priceCents: { MONTHLY: 9990, YEARLY: 8990 },
  },
  {
    id: "unlimited",
    label: "Workspaces ilimitados",
    maxWorkspaces: Number.POSITIVE_INFINITY,
    priceCents: null,
  },
];

function findPlan(plan: string): PlanDefinition {
  return PLANS.find((p) => p.id === plan) ?? PLANS[0];
}

export function isKnownPlan(plan: string): boolean {
  return PLANS.some((p) => p.id === plan);
}

export function isKnownCycle(cycle: string): cycle is PlanCycle {
  return cycle === "MONTHLY" || cycle === "YEARLY";
}

export function planLimit(plan: string): number {
  return findPlan(plan).maxWorkspaces;
}

export function planPriceCents(plan: string, cycle: PlanCycle): number | null {
  return findPlan(plan).priceCents?.[cycle] ?? null;
}

export function effectiveLimit(plan: string, status: string): number {
  return status === "TRIALING" ? 1 : planLimit(plan);
}

export function planLabel(plan: string): string {
  return findPlan(plan).label;
}
