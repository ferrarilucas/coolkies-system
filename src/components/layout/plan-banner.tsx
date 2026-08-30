import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function PlanBanner({
  status,
  workspaceName,
  canManage,
}: {
  status: string;
  workspaceName: string;
  canManage: boolean;
}) {
  if (status === "ACTIVE" || status === "TRIALING") return null;

  const overdue = status === "PAST_DUE";

  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5">
      <div className="mx-auto flex w-full max-w-2xl items-start gap-2.5 md:max-w-5xl">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-warning">
            {overdue
              ? "Pagamento pendente — o cadastro está em modo somente leitura."
              : "Assinatura cancelada — o cadastro está em modo somente leitura."}
          </p>
          <p className="text-muted-foreground">
            Você continua vendo tudo de {workspaceName}, mas não é possível
            registrar vendas ou alterar dados até regularizar.
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
