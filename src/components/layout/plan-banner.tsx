import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function PlanBanner({
  status,
  isOverLimit,
  isReadOnly,
  workspaceName,
  canManage,
}: {
  status: string;
  isOverLimit: boolean;
  isReadOnly: boolean;
  workspaceName: string;
  canManage: boolean;
}) {
  if (isOverLimit) {
    return (
      <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2.5 md:max-w-5xl">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-warning">
              {canManage
                ? "Este workspace está além do limite do seu plano. Os mais antigos continuam ativos — faça upgrade para liberar este."
                : "Este workspace está além do limite do plano de quem o criou. Os mais antigos continuam ativos — só quem administra a conta pode fazer o upgrade que libera este."}
            </p>
            {canManage && (
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
    const headline =
      status === "PAST_DUE"
        ? "Pagamento pendente — o cadastro está em modo somente leitura."
        : status === "TRIALING"
          ? "O teste terminou — o cadastro está em modo somente leitura."
          : status === "NONE"
            ? "Nenhum plano ativo — o cadastro está em modo somente leitura."
            : "Assinatura cancelada — o cadastro está em modo somente leitura.";
    const cta =
      status === "PAST_DUE" ? "Regularizar assinatura" : "Assinar um plano";

    return (
      <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2.5 md:max-w-5xl">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-warning">{headline}</p>
            <p className="text-muted-foreground">
              Você continua vendo tudo de {workspaceName}, mas não é possível
              registrar vendas ou alterar dados até que{" "}
              {canManage ? "você regularize" : "quem administra a conta regularize"}.
            </p>
            {canManage && (
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

  if (status === "PAST_DUE") {
    return (
      <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-2.5 md:max-w-5xl">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-warning">Pagamento pendente.</p>
            <p className="text-muted-foreground">
              {workspaceName} continua com o cadastro liberado durante a
              carência, mas o pagamento precisa ser regularizado antes que ela
              termine para não perder o acesso de escrita.
            </p>
            {canManage && (
              <Link
                href="/workspaces/plan"
                className="mt-1 inline-block font-medium text-primary underline underline-offset-4"
              >
                Regularizar assinatura
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
