import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { hasAcceptedCurrentTerms } from "@/server/tenant/account";
import { getWhatsAppLinkState, linkTokenPattern } from "@/server/tenant/whatsapp/link";
import { linkWhatsApp } from "./actions";

export const metadata = {
  title: "Vincular WhatsApp — Cipri",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function LinkWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const { token, status } = await searchParams;
  const validToken = typeof token === "string" && linkTokenPattern.test(token) ? token : null;
  const next = encodeURIComponent(validToken ? `/vincular-whatsapp?token=${validToken}` : "/vincular-whatsapp");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${next}`);
  if (!(await hasAcceptedCurrentTerms(session.user.id))) redirect(`/accept-terms?next=${next}`);

  const { linked, notice } = await getWhatsAppLinkState(session.user.id, validToken);
  const canLink = !linked && validToken && notice && !notice.consumedAt && notice.expiresAt > new Date();

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <h1 className="text-xl font-semibold">Vincular WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            {linked
              ? `O WhatsApp com final ${linked.slice(-4)} está vinculado. Você já pode voltar à conversa com o Cipri.`
              : canLink
                ? `Confirme o vínculo do WhatsApp com final ${notice.phone.slice(-4)} à sua conta ${session.user.email}.`
                : status === "invalid" || validToken
                  ? "Este link não está disponível. Envie uma mensagem ao Cipri no WhatsApp para receber um novo link quando disponível."
                  : "Abra o link que o Cipri enviou para você no WhatsApp para confirmar o vínculo."}
          </p>
          {canLink && (
            <form action={linkWhatsApp}>
              <input type="hidden" name="token" value={validToken} />
              <Button type="submit">Confirmar vínculo</Button>
            </form>
          )}
          <Button asChild variant="outline">
            <Link href="/workspaces/plan">Ver planos</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
