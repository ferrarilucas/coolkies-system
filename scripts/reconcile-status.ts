export type ReconcileDecision =
  | { action: "apply"; status: string; reason: string }
  | { action: "report"; reason: string }
  | { action: "none"; reason: string };

export type PeriodEndDecision =
  | { action: "apply"; currentPeriodEnd: Date; reason: string }
  | { action: "none"; reason: string };

const KNOWN_REMOTE_STATUSES = new Set([
  "PENDING_AUTH",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELED",
  "AUTH_DENIED",
]);

const DOWNGRADE_STATUSES = new Set(["SUSPENDED", "CANCELED", "AUTH_DENIED", "PAST_DUE"]);

const RECOVERABLE_LOCAL_STATUSES = new Set(["PAST_DUE", "SUSPENDED"]);

export function decideReconcile(input: { local: string; remote: string }): ReconcileDecision {
  if (!KNOWN_REMOTE_STATUSES.has(input.remote)) {
    return { action: "report", reason: `status remoto desconhecido: ${input.remote}` };
  }

  if (input.local === input.remote) {
    return { action: "none", reason: "estados iguais" };
  }

  if (DOWNGRADE_STATUSES.has(input.remote)) {
    return {
      action: "apply",
      status: input.remote,
      reason: `remoto rebaixou para ${input.remote} (local ${input.local})`,
    };
  }

  if (input.remote === "ACTIVE" && RECOVERABLE_LOCAL_STATUSES.has(input.local)) {
    return {
      action: "apply",
      status: input.remote,
      reason: `remoto voltou a cobrar normalmente (local ${input.local})`,
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
}): PeriodEndDecision {
  const remote = new Date(`${input.remoteNextDueDate}T00:00:00.000Z`);

  if (input.localPeriodEnd && input.localPeriodEnd.getTime() === remote.getTime()) {
    return { action: "none", reason: "vencimento igual" };
  }

  return {
    action: "apply",
    currentPeriodEnd: remote,
    reason: input.localPeriodEnd
      ? `vencimento local ${input.localPeriodEnd.toISOString()} difere do remoto ${input.remoteNextDueDate}`
      : `vencimento local ausente, remoto ${input.remoteNextDueDate}`,
  };
}
