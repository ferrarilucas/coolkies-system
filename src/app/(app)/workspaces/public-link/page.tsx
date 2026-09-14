import { PageHeader } from "@/components/shared/page-header";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getPublicLinkState } from "@/server/tenant/public-link";
import { PublicLinkToggle } from "@/components/workspaces/public-link-toggle";

export default async function PublicLinkPage() {
  const { workspaceId, role } = await getWorkspaceContext();
  const { token } = await getPublicLinkState(workspaceId);
  const publicUrl = token
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/p/${token}`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Link público do painel"
        description="Compartilhe o faturamento do mês sem precisar dar login a ninguém."
      />
      <PublicLinkToggle canManage={role === "OWNER"} enabled={token !== null} publicUrl={publicUrl} />
    </div>
  );
}
