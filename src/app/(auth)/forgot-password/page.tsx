"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await requestPasswordReset(email);
    setPending(false);
    if (result.error && result.error.status === 429) {
      setError(authErrorMessage(result.error));
      return;
    }
    setDone(true);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Esqueci minha senha</h1>
            <p className="text-sm text-muted-foreground">
              Informe seu e-mail e enviamos um link para você escolher uma nova senha.
            </p>
          </div>

          {done ? (
            <p className="text-sm text-muted-foreground">
              Se existir uma conta com {email}, o link já está a caminho. Confira também o spam.
            </p>
          ) : (
            <form className="space-y-3" onSubmit={onSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : "Enviar link"}
              </Button>
            </form>
          )}

          <Link href="/sign-in" className="block text-center text-xs text-muted-foreground underline-offset-4 hover:underline">
            Voltar para o login
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
