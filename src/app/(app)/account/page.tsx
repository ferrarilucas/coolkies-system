import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { DeleteAccountDialog } from "@/components/account/delete-account-dialog";
import { listOwnedWorkspaceNames } from "@/server/tenant/account";

export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const ownedWorkspaces = await listOwnedWorkspaceNames(session.user.id);

  return (
    <div className="space-y-6">
      <PageHeader title="Minha conta" description="Seus dados pessoais e o que fazer com eles." />

      <section className="space-y-1 rounded-lg border bg-card px-4 py-3">
        <p className="font-medium">{session.user.name}</p>
        <p className="text-sm text-muted-foreground">{session.user.email}</p>
      </section>

      <section className="space-y-2 rounded-lg border bg-card px-4 py-3">
        <h2 className="font-medium">Baixar meus dados</h2>
        <p className="text-sm text-muted-foreground">
          Um arquivo com seu perfil, formas de login, workspaces e assinatura. Os dados de vendas de cada workspace
          saem pela exportação em CSV.
        </p>
        <Button asChild variant="outline">
          <a href="/account/export">Baixar arquivo</a>
        </Button>
      </section>

      <section className="space-y-2 rounded-lg border border-destructive/40 bg-card px-4 py-3">
        <h2 className="font-medium">Excluir conta</h2>
        <p className="text-sm text-muted-foreground">
          Cancela a assinatura e apaga sua conta e os workspaces em que você é dono.
        </p>
        <DeleteAccountDialog email={session.user.email} ownedWorkspaces={ownedWorkspaces} />
      </section>
    </div>
  );
}
