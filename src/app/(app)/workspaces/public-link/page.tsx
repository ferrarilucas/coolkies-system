import { PageHeader } from "@/components/shared/page-header";
import { UpgradeNotice } from "@/components/shared/upgrade-notice";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getPublicLinkState } from "@/server/tenant/public-link";
import { workspaceHasFeature } from "@/server/tenant/features";
import { PublicLinkToggle } from "@/components/workspaces/public-link-toggle";

export default async function PublicLinkPage() {
  const { workspaceId, role } = await getWorkspaceContext();
  const [{ token }, allowed] = await Promise.all([
    getPublicLinkState(workspaceId),
    workspaceHasFeature(workspaceId, "publicLink"),
  ]);
  const publicUrl = token
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/p/${token}`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Link público do painel"
        description="Compartilhe o faturamento do mês sem precisar dar login a ninguém."
      />
      {allowed ? (
        <PublicLinkToggle canManage={role === "OWNER"} enabled={token !== null} publicUrl={publicUrl} />
      ) : (
        <UpgradeNotice
          title="O link público faz parte do plano Cresce"
          description="Com o Cresce, quem precisa só olhar acompanha o faturamento do mês sem login. Links já compartilhados ficam desativados até o upgrade."
        />
      )}
    </div>
  );
}
