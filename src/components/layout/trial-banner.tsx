import Link from "next/link";
import { Clock } from "lucide-react";

export function TrialBanner({
  daysLeft,
  canManage,
}: {
  daysLeft: number | null;
  canManage: boolean;
}) {
  if (daysLeft === null || !canManage) return null;

  const label =
    daysLeft === 0
      ? "Seu teste termina hoje"
      : daysLeft === 1
        ? "Falta 1 dia de teste"
        : `Faltam ${daysLeft} dias de teste`;

  return (
    <div className="border-b bg-primary/5 px-4 py-1.5">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 text-xs md:max-w-5xl">
        <Clock className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
        <Link
          href="/workspaces/plan"
          className="shrink-0 font-medium text-primary underline underline-offset-4"
        >
          Assinar
        </Link>
      </div>
    </div>
  );
}
