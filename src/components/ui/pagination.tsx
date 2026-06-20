import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  pageCount: number;
  buildHref: (page: number) => string;
  className?: string;
}

export function Pagination({ page, pageCount, buildHref, className }: PaginationProps) {
  if (pageCount <= 1) return null;

  const prev = page - 1;
  const next = page + 1;
  const hasPrev = page > 1;
  const hasNext = page < pageCount;

  // Gera janela de até 5 páginas ao redor da atual
  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(pageCount, page + 2);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <nav
      aria-label="Paginação"
      className={cn("flex items-center justify-center gap-1 pt-4", className)}
    >
      <Link
        href={buildHref(prev)}
        aria-disabled={!hasPrev}
        tabIndex={hasPrev ? 0 : -1}
        className={cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          !hasPrev && "pointer-events-none opacity-40",
          "h-9 w-9",
        )}
      >
        <ChevronLeft className="size-4" />
        <span className="sr-only">Anterior</span>
      </Link>

      {start > 1 && (
        <>
          <PageLink href={buildHref(1)} active={page === 1}>1</PageLink>
          {start > 2 && <span className="px-1 text-muted-foreground">…</span>}
        </>
      )}

      {pages.map((p) => (
        <PageLink key={p} href={buildHref(p)} active={p === page}>{p}</PageLink>
      ))}

      {end < pageCount && (
        <>
          {end < pageCount - 1 && <span className="px-1 text-muted-foreground">…</span>}
          <PageLink href={buildHref(pageCount)} active={page === pageCount}>{pageCount}</PageLink>
        </>
      )}

      <Link
        href={buildHref(next)}
        aria-disabled={!hasNext}
        tabIndex={hasNext ? 0 : -1}
        className={cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          !hasNext && "pointer-events-none opacity-40",
          "h-9 w-9",
        )}
      >
        <ChevronRight className="size-4" />
        <span className="sr-only">Próxima</span>
      </Link>
    </nav>
  );
}

function PageLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ variant: active ? "default" : "outline", size: "icon" }),
        "h-9 w-9 text-sm",
      )}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
