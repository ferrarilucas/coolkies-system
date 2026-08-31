import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  ChevronRight,
  Palette,
  Settings,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdmin, type SessionUser } from "@/lib/session-user";
import { getWorkspaceContext } from "@/server/tenant/context";
import { listUserWorkspaces } from "@/server/tenant/workspaces";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SignOutButton } from "@/components/layout/sign-out-button";

type MoreLink = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export default async function MorePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [{ workspaceId, role }, workspaces] = await Promise.all([
    getWorkspaceContext(),
    listUserWorkspaces(),
  ]);

  const user: SessionUser = {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
    role,
  };

  const links: MoreLink[] = [
    {
      href: "/customers",
      label: "Clientes",
      description: "Sua base de clientes",
      icon: Users,
    },
    {
      href: "/markets",
      label: "Mercados e preços",
      description: "Compras e custo de ingredientes",
      icon: Store,
    },
    ...(isAdmin(user)
      ? [
          {
            href: "/admin",
            label: "Cadastros",
            description: "Produtos, sabores, receitas e acesso",
            icon: Settings,
          },
        ]
      : []),
  ];

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader title="Mais" description="Outras áreas e configurações." />

      <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
        <Avatar className="size-11">
          {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Store className="size-3.5" />
          Workspace
        </p>
        <WorkspaceSwitcher
          workspaces={workspaces.map((w) => ({
            id: w.id,
            name: w.name,
            role: w.role,
          }))}
          activeId={workspaceId}
          variant="sidebar"
          side="bottom"
        />
      </div>

      <div className="divide-y rounded-lg border bg-card">
        {links.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50 active:bg-muted"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="size-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{label}</p>
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Palette className="size-3.5" />
          Tema
        </p>
        <ThemeToggle />
      </div>

      <SignOutButton />
    </div>
  );
}
