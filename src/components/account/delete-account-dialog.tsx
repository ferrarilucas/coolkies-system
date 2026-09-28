"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteAccount } from "@/server/actions/account";

export function DeleteAccountDialog({ email, ownedWorkspaces }: { email: string; ownedWorkspaces: string[] }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await deleteAccount(typed);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível excluir a conta.");
        return;
      }
      window.location.href = "/sign-in";
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">Excluir minha conta</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir sua conta?</DialogTitle>
          <DialogDescription>
            Isso cancela sua assinatura e apaga sua conta de forma definitiva. Não dá para desfazer.
          </DialogDescription>
        </DialogHeader>

        {ownedWorkspaces.length > 0 && (
          <div className="space-y-1 rounded-lg border border-destructive/40 p-3 text-sm">
            <p className="font-medium">Estes workspaces também serão apagados, com os dados de todos os membros:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {ownedWorkspaces.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="confirm-email">Para confirmar, digite {email}</Label>
          <Input id="confirm-email" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="destructive" disabled={pending || typed.trim() === ""} onClick={onConfirm}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Excluir definitivamente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
