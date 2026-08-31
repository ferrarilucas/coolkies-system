import { PageHeader } from "@/components/shared/page-header";
import { PlanPanel } from "@/components/workspaces/plan-panel";
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
        source={sub?.source ?? null}
        hasAsaasSubscriptionId={Boolean(sub?.asaasSubscriptionId)}
        ownedCount={owned}
        activeCount={active.size}
      />
    </div>
  );
}
