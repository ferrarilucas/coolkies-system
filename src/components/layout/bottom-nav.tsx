"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Menu,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WriteGate } from "./read-only-context";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  tour: string;
  extraPrefixes?: string[];
};

const leftItems: NavItem[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard, tour: "nav-dashboard" },
  { href: "/sales", label: "Vendas", icon: ShoppingCart, tour: "nav-sales" },
];

const rightItems: NavItem[] = [
  { href: "/customers", label: "Clientes", icon: Users, tour: "nav-customers" },
  {
    href: "/more",
    label: "Ajustes",
    icon: Menu,
    tour: "nav-more",
    extraPrefixes: ["/production", "/stock", "/purchases", "/admin", "/workspaces"],
  },
];

const FORM_ROUTE = /\/(new|edit)$/;

export function useIsFormRoute() {
  const pathname = usePathname();
  return FORM_ROUTE.test(pathname);
}

function NavLink({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) {
  const { href, label, icon: Icon, extraPrefixes, tour } = item;
  const prefixes = [href, ...(extraPrefixes ?? [])];
  const active = prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  return (
    <li className="flex-1">
      <Link
        href={href}
        data-tour={tour}
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
}

export function BottomNav() {
  const pathname = usePathname();
  const isFormRoute = useIsFormRoute();

  if (isFormRoute) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto flex max-w-md items-end justify-between px-2">
        {leftItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        <li className="flex-1">
          <WriteGate className="flex justify-center">
            <Link
              href="/sales/new"
              aria-label="Nova venda"
              data-tour="nav-sell"
              className="-mt-6 flex flex-col items-center gap-1 pb-2.5 text-[11px] font-medium text-primary"
            >
              <span className="flex size-14 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95">
                <Plus className="size-6" />
              </span>
              Vender
            </Link>
          </WriteGate>
        </li>

        {rightItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}
