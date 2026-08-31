import { addMonths, addYears } from "date-fns";

export type ReconcileCycle = "MONTHLY" | "YEARLY";

export type RemoteCharge = { status: string; dueDate: string | null };

export type ReconcileDecision =
  | { action: "activate"; reason: string }
  | { action: "report"; reason: string }
  | { action: "none"; reason: string };

const PAID_CHARGE_STATUSES = new Set(["RECEIVED", "CONFIRMED"]);

function coverageEnd(dueDate: string, cycle: ReconcileCycle): Date {
  const due = new Date(`${dueDate}T00:00:00.000Z`);
  return cycle === "YEARLY" ? addYears(due, 1) : addMonths(due, 1);
}

export function hasPaidCurrentCycle(
  charges: RemoteCharge[],
  cycle: ReconcileCycle,
  now: Date,
): boolean {
  return charges.some((charge) => {
    if (!PAID_CHARGE_STATUSES.has(charge.status)) return false;
    if (!charge.dueDate) return false;
    const end = coverageEnd(charge.dueDate, cycle);
    return end.getTime() > now.getTime();
  });
}

export function decideReconcile(input: {
  localStatus: string;
  cycle: ReconcileCycle;
  charges: RemoteCharge[];
  now: Date;
}): ReconcileDecision {
  if (input.localStatus === "CANCELED") {
    return { action: "none", reason: "cancelada localmente" };
  }

  const paid = hasPaidCurrentCycle(input.charges, input.cycle, input.now);

  if (input.localStatus === "ACTIVE") {
    return paid
      ? { action: "none", reason: "ativa com o ciclo corrente pago" }
      : {
          action: "report",
          reason: "ativa localmente sem cobranca paga no ciclo corrente",
        };
  }

  if (!paid) {
    return { action: "none", reason: "sem cobranca paga no ciclo corrente" };
  }

  return { action: "activate", reason: "cobranca paga cobrindo o ciclo corrente" };
}
