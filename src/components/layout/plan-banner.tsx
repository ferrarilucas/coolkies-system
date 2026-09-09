import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { activeBannerText, readOnlyBannerText } from "@/lib/plan-banner-copy";

export function PlanBanner({
  status,
  isOverLimit,
  isReadOnly,
  workspaceName,
  canManageBilling,
  hasAuthorized,
  lastFailureReason,
}: {
  status: string;
  isOverLimit: boolean;
  isReadOnly: boolean;
  workspaceName: string;
  canManageBilling: boolean;
  hasAuthorized: boolean;
  lastFailureReason: string | null;
}) {
  if (isOverLimit) {
    return (
      <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2.5 md:max-w-5xl">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-warning">
              {canManageBilling
                ? "Este workspace está além do limite do seu plano. Os mais antigos continuam ativos — faça upgrade para liberar este."
                : "Este workspace está além do limite do plano de quem o criou. Os mais antigos continuam ativos — só o dono da conta pode fazer o upgrade que libera este."}
            </p>
            {canManageBilling && (
              <Link
                href="/workspaces/plan"
                className="mt-1 inline-block font-medium text-primary underline underline-offset-4"
              >
                Fazer upgrade
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isReadOnly) {
    const { headline, cta } = readOnlyBannerText(status, hasAuthorized);

    return (
      <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2.5 md:max-w-5xl">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-warning">{headline}</p>
            <p className="text-muted-foreground">
              Você continua vendo tudo de {workspaceName}, mas não é possível
              registrar vendas ou alterar dados até que{" "}
              {canManageBilling ? "você regularize" : "o dono da conta regularize"}.
            </p>
            {canManageBilling && cta && (
              <Link
                href="/workspaces/plan"
                className="mt-1 inline-block font-medium text-primary underline underline-offset-4"
              >
                {cta}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const active = activeBannerText(status, hasAuthorized, lastFailureReason);
  if (!active) return null;

  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5">
      <div className="mx-auto flex w-full max-w-2xl items-start gap-2.5 md:max-w-5xl">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-warning">{active.headline}</p>
          {active.body && <p className="text-muted-foreground">{active.body}</p>}
          {canManageBilling && active.cta && (
            <Link
              href="/workspaces/plan"
              className="mt-1 inline-block font-medium text-primary underline underline-offset-4"
            >
              {active.cta}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
