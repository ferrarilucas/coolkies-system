import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import type { TrialState } from "@/lib/trial";

function runningLabel(daysLeft: number): string {
  if (daysLeft === 0) return "Seu teste termina hoje";
  if (daysLeft === 1) return "Falta 1 dia de teste";
  return `Faltam ${daysLeft} dias de teste`;
}

export function TrialBanner({
  trial,
  canManageBilling,
}: {
  trial: TrialState | null;
  canManageBilling: boolean;
}) {
  if (!trial || !canManageBilling) return null;

  const expired = trial.kind === "expired";

  return (
    <div
      className={
        expired
          ? "border-b border-warning/30 bg-warning/10 px-4 py-1.5"
          : "border-b bg-primary/5 px-4 py-1.5"
      }
    >
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 text-xs md:max-w-5xl">
        {expired ? (
          <AlertTriangle className="size-3.5 shrink-0 text-warning" />
        ) : (
          <Clock className="size-3.5 shrink-0 text-primary" />
        )}
        <span
          className={
            expired
              ? "min-w-0 flex-1 truncate font-medium text-warning"
              : "min-w-0 flex-1 truncate text-muted-foreground"
          }
        >
          {expired
            ? "Seu teste terminou — assine para voltar a registrar"
            : runningLabel(trial.daysLeft)}
        </span>
        <Link
          href="/workspaces/plan"
          className="shrink-0 font-medium text-primary underline underline-offset-4"
        >
          {expired ? "Assinar agora" : "Assinar"}
        </Link>
      </div>
    </div>
  );
}
