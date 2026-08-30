import { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { SideNav } from "./side-nav";
import { MainArea } from "./main-area";
import { PlanBanner } from "./plan-banner";
import { WorkspaceSwitcher, type WorkspaceOption } from "./workspace-switcher";
import type { SessionUser } from "@/lib/session-user";

export function AppShell({
  user,
  workspaces,
  activeWorkspaceId,
  planStatus,
  children,
}: {
  user: SessionUser;
  workspaces: WorkspaceOption[];
  activeWorkspaceId: string;
  planStatus: string;
  children: ReactNode;
}) {
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const canManage = active?.role === "OWNER" || active?.role === "ADMIN";
  const showMobileBar = workspaces.length > 1;

  return (
    <div className="flex h-dvh overflow-hidden">
      <SideNav
        user={user}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {showMobileBar && (
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeId={activeWorkspaceId}
            variant="bar"
          />
        )}
        <PlanBanner
          status={planStatus}
          workspaceName={active?.name ?? "este workspace"}
          canManage={canManage}
        />
        <MainArea>{children}</MainArea>
      </div>
      <BottomNav />
    </div>
  );
}
