import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { AcceptTermsForm } from "@/components/legal/accept-terms-form";
import { hasAcceptedCurrentTerms } from "@/server/tenant/account";

export default async function AcceptTermsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (await hasAcceptedCurrentTerms(session.user.id)) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Antes de continuar</h1>
            <p className="text-sm text-muted-foreground">
              Atualizamos nossos termos e nossa política de privacidade. Leia e aceite para seguir usando o Coolkies.
            </p>
          </div>
          <AcceptTermsForm />
        </CardContent>
      </Card>
    </main>
  );
}
