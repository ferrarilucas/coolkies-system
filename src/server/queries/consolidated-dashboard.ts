import { scopedDb } from "@/server/tenant/extension";

export type WorkspaceRevenueSummary = {
  workspaceId: string;
  workspaceName: string;
  paidRevenueCents: number;
  salesCount: number;
  avgTicketCents: number;
};

export async function getWorkspaceRevenueSummary(
  workspaceId: string,
  workspaceName: string,
  filters: { from: Date; to: Date },
): Promise<WorkspaceRevenueSummary> {
  const db = scopedDb(workspaceId);
  const sales = await db.sale.findMany({
    where: { status: "PAID", soldAt: { gte: filters.from, lte: filters.to } },
    select: { totalCents: true },
  });

  const paidRevenueCents = sales.reduce((sum, s) => sum + s.totalCents, 0);
  const salesCount = sales.length;
  const avgTicketCents = salesCount > 0 ? Math.round(paidRevenueCents / salesCount) : 0;

  return { workspaceId, workspaceName, paidRevenueCents, salesCount, avgTicketCents };
}

export async function getConsolidatedSummary(
  workspaces: { id: string; name: string }[],
  filters: { from: Date; to: Date },
): Promise<WorkspaceRevenueSummary[]> {
  const summaries: WorkspaceRevenueSummary[] = [];
  for (const ws of workspaces) {
    summaries.push(await getWorkspaceRevenueSummary(ws.id, ws.name, filters));
  }
  return summaries;
}
