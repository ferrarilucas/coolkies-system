import { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { SideNav } from "./side-nav";
import { MainArea } from "./main-area";
import type { SessionUser } from "@/lib/session-user";

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <SideNav user={user} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <MainArea>{children}</MainArea>
      </div>
      <BottomNav />
    </div>
  );
}
