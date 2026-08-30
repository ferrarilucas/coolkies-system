import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { listUserWorkspaces } from "@/server/tenant/workspaces";
import { getWorkspaceContext } from "@/server/tenant/context";
import { getWorkspacePlanState } from "@/server/tenant/subscription";
import type { SessionUser } from "@/lib/session-user";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const workspaces = await listUserWorkspaces();
  if (workspaces.length === 0) redirect("/onboarding");

  const { workspaceId } = await getWorkspaceContext();
  const active = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];
  const { status, isOverLimit } = await getWorkspacePlanState(active.id);

  const u = session.user as typeof session.user & { role?: string };
  const user: SessionUser = {
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    role: active.role,
  };

  return (
    <AppShell
      user={user}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role }))}
      activeWorkspaceId={active.id}
      planStatus={status}
      isOverLimit={isOverLimit}
    >
      {children}
    </AppShell>
  );
}
