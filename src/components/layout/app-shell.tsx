import { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { SideNav } from "./side-nav";
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
        <main className="flex-1 pb-20 md:pb-6">
          <div className="mx-auto w-full max-w-2xl px-4 py-4 md:max-w-5xl md:py-6">
            {children}
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
