"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Cookie,
  UtensilsCrossed,
  Store,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isAdmin, type SessionUser } from "@/lib/session-user";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/sales", label: "Vendas", icon: ShoppingCart },
  { href: "/products", label: "Produtos", icon: Cookie },
  { href: "/pantry", label: "Despensa", icon: UtensilsCrossed },
  { href: "/admin", label: "Cadastros", icon: Settings, adminOnly: true },
];

export function BottomNav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const visibleItems = items.filter((i) => !i.adminOnly || isAdmin(user));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-between px-2">
        {visibleItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
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
