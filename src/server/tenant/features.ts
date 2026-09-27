import type { PlanFeature } from "@/lib/plans";
import { db } from "@/lib/db";
import { getSubscription, subscriptionHasFeature } from "./subscription";

export const FEATURE_UNAVAILABLE_MESSAGE =
  "Este recurso faz parte do plano Cresce. Faça upgrade para usar.";

export class FeatureUnavailableError extends Error {
  constructor() {
    super(FEATURE_UNAVAILABLE_MESSAGE);
    this.name = "FeatureUnavailableError";
  }
}

export async function userHasFeature(userId: string, feature: PlanFeature): Promise<boolean> {
  return subscriptionHasFeature(await getSubscription(userId), feature);
}

export async function workspaceHasFeature(
  workspaceId: string,
  feature: PlanFeature,
): Promise<boolean> {
  const owner = await db.member.findFirst({
    where: { workspaceId, role: "OWNER" },
    select: { userId: true },
  });
  if (!owner) return false;
  return userHasFeature(owner.userId, feature);
}

export async function assertWorkspaceFeature(
  workspaceId: string,
  feature: PlanFeature,
): Promise<void> {
  if (!(await workspaceHasFeature(workspaceId, feature))) {
    throw new FeatureUnavailableError();
  }
}
