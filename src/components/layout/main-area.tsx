"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useIsFormRoute } from "./bottom-nav";

export function MainArea({ children }: { children: ReactNode }) {
  const isFormRoute = useIsFormRoute();

  return (
    <main className={cn("flex-1", isFormRoute ? "pb-6" : "pb-20 md:pb-6")}>
      <div className="mx-auto w-full max-w-2xl px-4 py-4 md:max-w-5xl md:py-6">
        {children}
      </div>
    </main>
  );
}
