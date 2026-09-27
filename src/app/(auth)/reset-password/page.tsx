import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const valid = Boolean(token) && !error;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 pt-6">
          <h1 className="text-lg font-semibold">Nova senha</h1>
          {valid ? (
            <ResetPasswordForm token={token as string} />
          ) : (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Este link expirou ou já foi usado.</p>
              <Link href="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
                Pedir um novo link
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
