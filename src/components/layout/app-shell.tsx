import { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { SideNav } from "./side-nav";
import { MainArea } from "./main-area";
import { PlanBanner } from "./plan-banner";
import { TrialBanner } from "./trial-banner";
import { WorkspaceSwitcher, type WorkspaceOption } from "./workspace-switcher";
import type { SessionUser } from "@/lib/session-user";
import type { TrialState } from "@/lib/trial";

export function AppShell({
  user,
  workspaces,
  activeWorkspaceId,
  planStatus,
  isOverLimit,
  isReadOnly,
  trial,
  children,
}: {
  user: SessionUser;
  workspaces: WorkspaceOption[];
  activeWorkspaceId: string;
  planStatus: string;
  isOverLimit: boolean;
  isReadOnly: boolean;
  trial: TrialState | null;
  children: ReactNode;
}) {
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const canManageBilling = active?.role === "OWNER";
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
        <TrialBanner trial={trial} canManageBilling={canManageBilling} />
        <PlanBanner
          status={planStatus}
          isOverLimit={isOverLimit}
          isReadOnly={isReadOnly}
          workspaceName={active?.name ?? "este workspace"}
          canManageBilling={canManageBilling}
        />
        <MainArea>{children}</MainArea>
      </div>
      <BottomNav />
    </div>
  );
}
