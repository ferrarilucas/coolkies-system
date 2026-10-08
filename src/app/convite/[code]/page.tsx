import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AcceptInviteButton } from "@/components/workspaces/accept-invite-button";
import { auth } from "@/lib/auth";
import { roleLabel } from "@/lib/roles";
import { hasAcceptedCurrentTerms } from "@/server/tenant/account";
import { getInvitePreview, normalizeInviteCode } from "@/server/tenant/workspaces";

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeInviteCode((await params).code);
  const here = `/convite/${code}`;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  if (!(await hasAcceptedCurrentTerms(session.user.id))) {
    redirect(`/accept-terms?next=${encodeURIComponent(here)}`);
  }

  const invite = await getInvitePreview(code);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <Logo className="mb-8 h-14" />
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-5 pt-6 text-center">
          {invite ? (
            <>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {invite.inviterName} convidou você para
                </p>
                <h1 className="text-2xl font-bold">{invite.workspaceName}</h1>
                <p className="text-sm text-muted-foreground">
                  Você vai entrar como {roleLabel(invite.role)}.
                </p>
              </div>
              <AcceptInviteButton code={code} />
            </>
          ) : (
            <>
              <div className="space-y-2">
                <h1 className="text-lg font-semibold">Convite indisponível</h1>
                <p className="text-sm text-muted-foreground">
                  Este convite expirou, foi cancelado ou já foi usado. Peça um novo a quem administra o workspace.
                </p>
              </div>
              <Button asChild className="w-full">
                <Link href="/dashboard">Ir para o painel</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
