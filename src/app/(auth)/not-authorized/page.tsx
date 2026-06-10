import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotAuthorizedPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center pt-8 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-destructive/10">
            <ShieldX className="size-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold">Acesso não autorizado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sua conta Google não está liberada para acessar o app. Fale com o
            administrador para solicitar o pré-cadastro do seu e-mail.
          </p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link href="/sign-in">Voltar ao login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
