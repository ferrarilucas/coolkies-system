"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { READ_ONLY_MESSAGE } from "@/lib/read-only";

const ReadOnlyContext = createContext(false);

export function ReadOnlyProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: ReactNode;
}) {
  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

export function WriteGate({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const readOnly = useReadOnly();
  if (!readOnly) return children;

  return (
    <span
      title={READ_ONLY_MESSAGE}
      aria-disabled
      className={cn("inline-flex cursor-not-allowed opacity-50", className)}
    >
      <span inert className="contents">
        {children}
      </span>
    </span>
  );
}
