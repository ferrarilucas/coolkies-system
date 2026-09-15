import { notFound } from "next/navigation";
import { resolveWorkspaceByPublicToken } from "@/server/tenant/public-link";
import { getWorkspaceRevenueSummary } from "@/server/queries/consolidated-dashboard";
import { formatBRL } from "@/lib/money";
import { canWriteInWorkspace } from "@/server/tenant/subscription";

function monthRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export default async function PublicWorkspacePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const workspace = await resolveWorkspaceByPublicToken(token);
  if (!workspace) notFound();

  const active = await canWriteInWorkspace(workspace.id);
  if (!active) notFound();

  const { from, to } = monthRange();
  const summary = await getWorkspaceRevenueSummary(workspace.id, workspace.name, { from, to });

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{workspace.name}</p>
        <h1 className="text-2xl font-semibold">Faturamento do mês</h1>
      </div>
      <div className="rounded-lg border bg-card px-4 py-4">
        <p className="text-3xl font-semibold tabular-nums">{formatBRL(summary.paidRevenueCents)}</p>
        <p className="text-sm text-muted-foreground">
          {summary.salesCount} vendas · ticket médio {formatBRL(summary.avgTicketCents)}
        </p>
      </div>
    </main>
  );
}
