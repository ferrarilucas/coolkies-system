import { isValidIsoCalendarDate } from "../src/lib/date-validation";

export type ReconcileApplyStatus = "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" | "AUTH_DENIED";

export type ReconcileDecision =
  | { action: "apply"; status: ReconcileApplyStatus; reason: string; lastPaidAt?: Date }
  | { action: "report"; reason: string }
  | { action: "none"; reason: string };

export type PeriodEndDecision =
  | { action: "apply"; currentPeriodEnd: Date; recordPaidThroughAt: boolean; reason: string }
  | { action: "none"; reason: string };

const KNOWN_REMOTE_STATUSES = new Set([
  "PENDING_AUTH",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELED",
  "AUTH_DENIED",
]);

const UNCONDITIONAL_DOWNGRADE_STATUSES: ReadonlyArray<ReconcileApplyStatus> = [
  "SUSPENDED",
  "CANCELED",
  "AUTH_DENIED",
];

const PAID_ACCESS_LOCAL_STATUSES = new Set(["ACTIVE", "PAST_DUE"]);

const RECOVERABLE_LOCAL_STATUSES = new Set(["PAST_DUE", "SUSPENDED"]);

const PAID_EVIDENCE_BLOCKED_LOCAL_STATUSES = new Set(["SUSPENDED"]);

function isUnconditionalDowngradeStatus(value: string): value is ReconcileApplyStatus {
  return (UNCONDITIONAL_DOWNGRADE_STATUSES as readonly string[]).includes(value);
}

export function decideReconcile(input: {
  local: string;
  remote: string;
  now?: Date;
}): ReconcileDecision {
  const now = input.now ?? new Date();
  if (!KNOWN_REMOTE_STATUSES.has(input.remote)) {
    return { action: "report", reason: `status remoto desconhecido: ${input.remote}` };
  }

  if (input.local === input.remote) {
    return { action: "none", reason: "estados iguais" };
  }

  if (isUnconditionalDowngradeStatus(input.remote)) {
    return {
      action: "apply",
      status: input.remote,
      reason: `remoto rebaixou para ${input.remote} (local ${input.local})`,
    };
  }

  if (input.remote === "PAST_DUE") {
    if (PAID_ACCESS_LOCAL_STATUSES.has(input.local)) {
      return {
        action: "apply",
        status: "PAST_DUE",
        reason: `remoto deixou de receber o pagamento (local ${input.local})`,
      };
    }

    return {
      action: "report",
      reason: `local ${input.local} nunca teve acesso pago; PAST_DUE remoto não concede nada`,
    };
  }

  if (input.remote === "ACTIVE" && RECOVERABLE_LOCAL_STATUSES.has(input.local)) {
    return {
      action: "apply",
      status: input.remote,
      reason: `remoto voltou a cobrar normalmente (local ${input.local})`,
      ...(input.local === "PAST_DUE" ? { lastPaidAt: now } : {}),
    };
  }

  return {
    action: "report",
    reason: `local ${input.local}, remoto ${input.remote} — divergência não aplicada por segurança`,
  };
}

export function decidePeriodEndCorrection(input: {
  localPeriodEnd: Date | null;
  remoteNextDueDate: string;
  priorLocalStatus: string;
  effectiveStatus: string;
}): PeriodEndDecision {
  if (!isValidIsoCalendarDate(input.remoteNextDueDate)) {
    return { action: "none", reason: `vencimento remoto inválido: ${input.remoteNextDueDate}` };
  }

  const remote = new Date(`${input.remoteNextDueDate}T00:00:00.000Z`);

  if (input.localPeriodEnd && input.localPeriodEnd.getTime() === remote.getTime()) {
    return { action: "none", reason: "vencimento igual" };
  }

  const recordPaidThroughAt =
    input.effectiveStatus === "ACTIVE" &&
    !PAID_EVIDENCE_BLOCKED_LOCAL_STATUSES.has(input.priorLocalStatus);

  return {
    action: "apply",
    currentPeriodEnd: remote,
    recordPaidThroughAt,
    reason: input.localPeriodEnd
      ? `vencimento local ${input.localPeriodEnd.toISOString()} difere do remoto ${input.remoteNextDueDate}`
      : `vencimento local ausente, remoto ${input.remoteNextDueDate}`,
  };
}
