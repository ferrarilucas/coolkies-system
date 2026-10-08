"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { joinWorkspace } from "@/server/actions/workspaces";

export function AcceptInviteButton({ code }: { code: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onAccept() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("code", code);
      const result = await joinWorkspace(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível entrar.");
        return;
      }
      toast.success("Você entrou no workspace.");
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <Button size="lg" className="w-full" disabled={pending} onClick={onAccept}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : "Aceitar convite"}
    </Button>
  );
}
