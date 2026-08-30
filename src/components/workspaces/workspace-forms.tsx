"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspace, joinWorkspace } from "@/server/actions/workspaces";

type FormProps = {
  onDone?: () => void;
  redirectTo?: string;
};

export function CreateWorkspaceForm({ onDone, redirectTo = "/dashboard" }: FormProps) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createWorkspace(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível criar o workspace.");
        return;
      }
      toast.success("Workspace criado.");
      onDone?.();
      router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nome do negócio</Label>
        <Input
          id="name"
          name="name"
          placeholder="Ex.: Douce Vie"
          autoComplete="off"
          autoFocus
          required
          maxLength={60}
        />
        <p className="text-xs text-muted-foreground">
          É assim que ele aparece no seletor. Dá para mudar depois.
        </p>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Criando..." : "Criar workspace"}
      </Button>
    </form>
  );
}

export function JoinWorkspaceForm({ onDone, redirectTo = "/dashboard" }: FormProps) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const router = useRouter();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await joinWorkspace(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível entrar.");
        return;
      }
      toast.success("Você entrou no workspace.");
      onDone?.();
      router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="code">Código do convite</Label>
        <Input
          id="code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          inputMode="text"
          autoFocus
          required
          className="text-center font-mono text-lg tracking-[0.2em]"
        />
        <p className="text-xs text-muted-foreground">
          Peça o código a quem administra o workspace. Ele vale por 7 dias.
        </p>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Entrando..." : "Entrar no workspace"}
      </Button>
    </form>
  );
}
