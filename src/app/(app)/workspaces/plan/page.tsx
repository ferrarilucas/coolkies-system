import { PageHeader } from "@/components/shared/page-header";
import { PlanPanel } from "@/components/workspaces/plan-panel";
import { isTrialExpired } from "@/lib/trial";
import { getWorkspaceContext } from "@/server/tenant/context";
import {
  activeWorkspaceIds,
  countOwnedWorkspaces,
  getSubscription,
} from "@/server/tenant/subscription";

export default async function PlanPage() {
  const { userId } = await getWorkspaceContext();
  const [sub, owned, active] = await Promise.all([
    getSubscription(userId),
    countOwnedWorkspaces(userId),
    activeWorkspaceIds(userId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assinatura"
        description="Seu plano define quantos workspaces você pode ter."
      />
      <PlanPanel
        currentPlan={sub?.plan ?? null}
        currentCycle={sub?.cycle ?? null}
        status={sub?.status ?? null}
        trialExpired={isTrialExpired(sub?.status ?? "NONE", sub?.trialEndsAt ?? null)}
        provider={sub?.provider ?? null}
        hasSubscriptionId={Boolean(sub?.interpixSubscriptionId)}
        ownedCount={owned}
        activeCount={active.size}
        pixCopyPaste={sub?.interpixPixCopyPaste ?? null}
        nextDueDate={sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString().slice(0, 10) : null}
      />
    </div>
  );
}
