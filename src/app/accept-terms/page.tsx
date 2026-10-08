import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { TERMS_VERSION } from "@/lib/legal";
import { safeNextPath } from "@/lib/next-path";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AcceptTermsForm } from "@/components/legal/accept-terms-form";
import { DeleteAccountDialog } from "@/components/account/delete-account-dialog";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { getAcceptedTermsVersion, listOwnedWorkspaceNames } from "@/server/tenant/account";

export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const acceptedVersion = await getAcceptedTermsVersion(session.user.id);
  if (acceptedVersion === TERMS_VERSION) redirect(next);
  const ownedWorkspaces = await listOwnedWorkspaceNames(session.user.id);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Antes de continuar</h1>
            <p className="text-sm text-muted-foreground">
              {acceptedVersion === null
                ? "Para começar, leia e aceite nossos termos de uso e nossa política de privacidade."
                : "Atualizamos nossos termos e nossa política de privacidade. Leia e aceite para seguir usando o Cipri."}
            </p>
          </div>
          <AcceptTermsForm next={next} />
          <section className="space-y-3 border-t pt-4">
            <div className="space-y-1">
              <h2 className="text-sm font-medium">Não concorda?</h2>
              <p className="text-sm text-muted-foreground">
                Você pode sair, baixar uma cópia dos seus dados ou excluir sua conta.
              </p>
            </div>
            <SignOutButton />
            <Button asChild variant="outline" className="w-full">
              <a href="/account/export">Baixar meus dados</a>
            </Button>
            <DeleteAccountDialog email={session.user.email} ownedWorkspaces={ownedWorkspaces} />
          </section>
        </CardContent>
      </Card>
    </main>
  );
}
