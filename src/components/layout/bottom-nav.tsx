"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Cookie,
  UtensilsCrossed,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  extraPrefixes?: string[];
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/sales", label: "Vendas", icon: ShoppingCart },
  { href: "/products", label: "Produtos", icon: Cookie },
  { href: "/pantry", label: "Despensa", icon: UtensilsCrossed },
  {
    href: "/more",
    label: "Mais",
    icon: Menu,
    extraPrefixes: ["/customers", "/markets", "/admin"],
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-between px-2">
        {items.map(({ href, label, icon: Icon, extraPrefixes }) => {
          const prefixes = [href, ...(extraPrefixes ?? [])];
          const active = prefixes.some(
            (p) => pathname === p || pathname.startsWith(`${p}/`),
          );
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
