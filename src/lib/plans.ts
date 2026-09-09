export type PlanCycle = "MONTHLY" | "YEARLY";
export type PaymentMethod = "PIX" | "CARD";

type PlanDefinition = {
  id: string;
  label: string;
  workspacesLabel: string;
  maxWorkspaces: number;
  baseMonthlyCents: number | null;
};

const YEARLY_DISCOUNT_CENTS = 1000;
const PIX_DISCOUNT_CENTS = 500;
const MONTHS_IN_YEAR = 12;

export const PLANS: PlanDefinition[] = [
  {
    id: "corre",
    label: "Corre",
    workspacesLabel: "1 workspace",
    maxWorkspaces: 1,
    baseMonthlyCents: 3950,
  },
  {
    id: "cresce",
    label: "Cresce",
    workspacesLabel: "Até 4 workspaces",
    maxWorkspaces: 4,
    baseMonthlyCents: 9990,
  },
  {
    id: "escala",
    label: "Escala",
    workspacesLabel: "Workspaces ilimitados",
    maxWorkspaces: Number.POSITIVE_INFINITY,
    baseMonthlyCents: null,
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

export function monthlyPriceCents(
  plan: string,
  cycle: PlanCycle,
  method: PaymentMethod,
): number | null {
  const base = findPlan(plan).baseMonthlyCents;
  if (base === null) return null;

  const yearly = cycle === "YEARLY" ? YEARLY_DISCOUNT_CENTS : 0;
  const pix = method === "PIX" ? PIX_DISCOUNT_CENTS : 0;
  return base - yearly - pix;
}

export function chargeAmountCents(
  plan: string,
  cycle: PlanCycle,
  method: PaymentMethod,
): number | null {
  const monthly = monthlyPriceCents(plan, cycle, method);
  if (monthly === null) return null;
  return cycle === "YEARLY" ? monthly * MONTHS_IN_YEAR : monthly;
}

export function planLimit(plan: string): number {
  return findPlan(plan).maxWorkspaces;
}

export function effectiveLimit(plan: string, status: string, hasPaid = false): number {
  if (status === "TRIALING" || status === "PENDING_AUTH") return 1;
  if ((status === "PAST_DUE" || status === "CANCELED") && !hasPaid) return 1;
  return planLimit(plan);
}

export function planLabel(plan: string): string {
  return findPlan(plan).label;
}

export function planWorkspacesLabel(plan: string): string {
  return findPlan(plan).workspacesLabel;
}
