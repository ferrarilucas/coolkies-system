"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { togglePublicLink } from "@/server/actions/public-link";

export function PublicLinkToggle({
  canManage,
  enabled,
  publicUrl,
}: {
  canManage: boolean;
  enabled: boolean;
  publicUrl: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onChange(checked: boolean) {
    startTransition(async () => {
      const res = await togglePublicLink(checked);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível atualizar o link.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Link público
          <Switch checked={enabled} onCheckedChange={onChange} disabled={pending || !canManage} />
        </CardTitle>
        <CardDescription>
          {canManage
            ? "Qualquer pessoa com o link vê o faturamento do mês, sem poder editar nada."
            : "Só o dono do workspace pode ativar ou desativar o link."}
        </CardDescription>
      </CardHeader>
      {canManage && publicUrl && (
        <CardContent>
          <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{publicUrl}</p>
        </CardContent>
      )}
    </Card>
  );
}
