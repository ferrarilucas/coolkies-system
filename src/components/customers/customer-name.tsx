import { cn } from "@/lib/utils";

export function SectorBadge({
  sector,
  className,
}: {
  sector?: string | null;
  className?: string;
}) {
  if (!sector?.trim()) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {sector}
    </span>
  );
}

export function CustomerName({
  name,
  sector,
  className,
  nameClassName,
  fallback = "Sem identificação",
}: {
  name?: string | null;
  sector?: string | null;
  className?: string;
  nameClassName?: string;
  fallback?: React.ReactNode;
}) {
  if (!name?.trim()) {
    return <span className="text-muted-foreground italic">{fallback}</span>;
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span className={cn("truncate", nameClassName)}>{name}</span>
      <SectorBadge sector={sector} />
    </span>
  );
}
