"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, LogIn, Plus, Settings2, Store } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { roleLabel } from "@/lib/roles";
import { switchWorkspace } from "@/server/actions/workspaces";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CreateWorkspaceForm,
  JoinWorkspaceForm,
} from "@/components/workspaces/workspace-forms";

export type WorkspaceOption = {
  id: string;
  name: string;
  role: string;
};

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  variant = "bar",
  side,
}: {
  workspaces: WorkspaceOption[];
  activeId: string;
  variant?: "bar" | "sidebar";
  side?: "bottom" | "right";
}) {
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  if (!active) return null;

  function select(id: string) {
    if (id === activeId) return;
    startTransition(async () => {
      const result = await switchWorkspace(id);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível trocar de workspace.");
        return;
      }
      router.refresh();
    });
  }

  const trigger =
    variant === "sidebar" ? (
      <button
        type="button"
        title={active.name}
        className="flex w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left transition-colors hover:bg-muted"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Store className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{active.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {roleLabel(active.role)}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    ) : (
      <button
        type="button"
        className="flex w-full items-center gap-2 border-b bg-background/95 px-4 py-2.5 text-left backdrop-blur transition-colors hover:bg-muted/50 md:hidden"
      >
        <Store className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {active.name}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={side ?? (variant === "sidebar" ? "right" : "bottom")}
          sideOffset={6}
          className="w-[min(20rem,calc(100vw-2rem))]"
        >
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>

          {workspaces.map((w) => {
            const isActive = w.id === activeId;
            return (
              <DropdownMenuItem
                key={w.id}
                disabled={pending}
                onSelect={() => select(w.id)}
                className="gap-2 py-2"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded text-[10px] font-semibold uppercase",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {w.name.slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{w.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {roleLabel(w.role)}
                  </span>
                </span>
                {isActive && <Check className="size-4 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setDialog("create")} className="gap-2">
            <Plus className="size-4 text-muted-foreground" />
            Criar workspace
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("join")} className="gap-2">
            <LogIn className="size-4 text-muted-foreground" />
            Entrar com código
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => router.push("/workspaces/members")}
            className="gap-2"
          >
            <Settings2 className="size-4 text-muted-foreground" />
            Pessoas e convites
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog === "create" ? "Criar workspace" : "Entrar com código"}
            </DialogTitle>
          </DialogHeader>
          {dialog === "create" && (
            <CreateWorkspaceForm onDone={() => setDialog(null)} />
          )}
          {dialog === "join" && <JoinWorkspaceForm onDone={() => setDialog(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
