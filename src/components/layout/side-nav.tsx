"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Cookie,
  UtensilsCrossed,
  Store,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth-client";
import { isAdmin, type SessionUser } from "@/lib/session-user";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./theme-toggle";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/sales", label: "Vendas", icon: ShoppingCart },
  { href: "/customers", label: "Clientes", icon: Users },
  { href: "/products", label: "Produtos", icon: Cookie },
  { href: "/pantry", label: "Despensa", icon: UtensilsCrossed },
  { href: "/markets", label: "Mercados e preços", icon: Store },
  { href: "/admin", label: "Cadastros", icon: Settings, adminOnly: true },
];

const STORAGE_KEY = "sidebar:collapsed";

/** Sidebar visível apenas em desktop (md+). Mobile usa BottomNav. */
export function SideNav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const visibleItems = items.filter((i) => !i.adminOnly || isAdmin(user));

  return (
    <aside
      className={cn(
        "hidden h-dvh shrink-0 flex-col border-r bg-card transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Topo: marca + toggle */}
      <div
        className={cn(
          "flex h-14 items-center border-b px-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Cookie className="size-5 text-primary" />
            <span className="font-semibold">Coolkies</span>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>
      </div>

      {/* Navegação */}
      <nav className="flex-1 p-2">
        <ul className="space-y-1">
          {visibleItems.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  title={collapsed ? label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "px-3",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: usuário + logout */}
      <UserFooter user={user} collapsed={collapsed} />
    </aside>
  );
}

function UserFooter({
  user,
  collapsed,
}: {
  user: SessionUser;
  collapsed: boolean;
}) {
  const router = useRouter();

  async function handleLogout() {
    await signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const avatar = (
    <Avatar className={collapsed ? "size-8" : "size-9"}>
      {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );

  return (
    <div className="border-t p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-muted",
              collapsed && "justify-center",
            )}
            title={collapsed ? user.name : undefined}
          >
            {avatar}
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-60">
          <div className="p-2">
            <ThemeToggle />
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleLogout}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="size-4" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
