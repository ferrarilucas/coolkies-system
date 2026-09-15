import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { listUserWorkspaces } from "@/server/tenant/workspaces";
import { activeWorkspaceIds } from "@/server/tenant/subscription";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getConsolidatedSummary } from "@/server/queries/consolidated-dashboard";
import { formatBRL } from "@/lib/money";

function monthRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export default async function ConsolidatedDashboardPage() {
  const { userId } = await getWorkspaceContext();
  const [owned, active] = await Promise.all([listUserWorkspaces(), activeWorkspaceIds(userId)]);
  const workspaces = owned.filter((w) => w.role === "OWNER" && active.has(w.id));

  const { from, to } = monthRange();
  const summaries = workspaces.length > 0 ? await getConsolidatedSummary(workspaces, { from, to }) : [];

  const totalRevenueCents = summaries.reduce((sum, s) => sum + s.paidRevenueCents, 0);
  const totalSales = summaries.reduce((sum, s) => sum + s.salesCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel consolidado"
        description="Soma do faturamento pago de todos os seus workspaces neste mês."
      />

      {summaries.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhum workspace para consolidar"
          description="Você precisa ser dono de pelo menos um workspace ativo para ver o consolidado."
        />
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">Faturamento pago no mês (todos os workspaces)</p>
            <p className="text-2xl font-semibold tabular-nums">{formatBRL(totalRevenueCents)}</p>
            <p className="text-xs text-muted-foreground">{totalSales} vendas</p>
          </div>

          <div className="space-y-2">
            {summaries.map((s) => (
              <div key={s.workspaceId} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
                <div>
                  <p className="font-medium">{s.workspaceName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.salesCount} vendas · ticket médio {formatBRL(s.avgTicketCents)}
                  </p>
                </div>
                <p className="font-semibold tabular-nums">{formatBRL(s.paidRevenueCents)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
