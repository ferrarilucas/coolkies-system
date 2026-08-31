export type ReconcileStatus = "ACTIVE" | "PAST_DUE";

const KNOWN_ACTIVE_STATUSES = new Set(["ACTIVE"]);
const KNOWN_PAST_DUE_STATUSES = new Set<string>([]);

export function expectedStatusFor(remoteStatus: string): ReconcileStatus | null {
  if (KNOWN_ACTIVE_STATUSES.has(remoteStatus)) return "ACTIVE";
  if (KNOWN_PAST_DUE_STATUSES.has(remoteStatus)) return "PAST_DUE";
  return null;
}
