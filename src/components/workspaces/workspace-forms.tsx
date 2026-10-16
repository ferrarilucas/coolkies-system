"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspace, joinWorkspace } from "@/server/actions/workspaces";
import { SectorPicker } from "@/components/onboarding/sector-picker";
import type { SectorKey } from "@/lib/onboarding/sectors";

type FormProps = {
  onDone?: () => void;
  redirectTo?: string;
};

export function CreateWorkspaceForm({ onDone, redirectTo = "/dashboard" }: FormProps) {
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"name" | "sector">("name");
  const [name, setName] = useState("");
  const [sector, setSector] = useState<SectorKey | null>(null);
  const router = useRouter();

  function submit() {
    if (!sector) return;
    const formData = new FormData();
    formData.set("name", name);
    formData.set("sector", sector);
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

  if (step === "name") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) setStep("sector");
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="name">Nome do negócio</Label>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
        <Button type="submit" disabled={!name.trim()} className="w-full">
          Continuar
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4 duration-300 animate-in fade-in slide-in-from-right-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Qual é o ramo do seu negócio?</p>
        <p className="text-xs text-muted-foreground">
          Usamos isso para mostrar os primeiros passos certos para você.
        </p>
      </div>
      <SectorPicker value={sector} onChange={setSector} disabled={pending} />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setStep("name")} disabled={pending}>
          Voltar
        </Button>
        <Button type="button" className="flex-1" onClick={submit} disabled={pending || !sector}>
          {pending ? "Criando..." : "Criar workspace"}
        </Button>
      </div>
    </div>
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
