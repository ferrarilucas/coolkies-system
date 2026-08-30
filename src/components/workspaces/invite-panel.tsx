"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { roleLabel, ROLE_DESCRIPTION } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cancelInvite, createInvite } from "@/server/actions/workspaces";

export type PendingInvite = {
  id: string;
  code: string;
  role: string;
  email: string | null;
  expiresAt: string;
};

function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function InvitePanel({ invites }: { invites: PendingInvite[] }) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function onCreate(formData: FormData) {
    const wantsEmail = String(formData.get("email") ?? "").trim().length > 0;

    startTransition(async () => {
      const result = await createInvite(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível gerar o convite.");
        return;
      }

      if (!wantsEmail) {
        toast.success("Código gerado. Copie e envie como preferir.");
      } else if (result.data?.emailSent) {
        toast.success("Convite enviado por e-mail.");
      } else {
        toast.warning(
          result.data?.emailError
            ? `Código gerado, mas o e-mail não saiu: ${result.data.emailError}`
            : "Código gerado, mas o e-mail não saiu. Copie e envie manualmente.",
        );
      }

      setOpen(false);
      router.refresh();
    });
  }

  function onCancel(id: string) {
    startTransition(async () => {
      const result = await cancelInvite(id);
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível cancelar.");
        return;
      }
      router.refresh();
    });
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(formatCode(code));
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Convites abertos
        </h2>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Convidar
        </Button>
      </div>

      {invites.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhum convite aberto.
        </p>
      ) : (
        <ul className="space-y-2">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => copy(invite.code)}
                  className="flex items-center gap-2 font-mono text-base font-semibold tracking-wider transition-colors hover:text-primary"
                >
                  {formatCode(invite.code)}
                  {copied === invite.code ? (
                    <Check className="size-4 text-success" />
                  ) : (
                    <Copy className="size-3.5 text-muted-foreground" />
                  )}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  {roleLabel(invite.role)}
                  {invite.email ? ` · ${invite.email}` : ""} · expira{" "}
                  {new Date(invite.expiresAt).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                disabled={pending}
                onClick={() => onCancel(invite.id)}
                aria-label="Cancelar convite"
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convidar para o workspace</DialogTitle>
          </DialogHeader>

          <form action={onCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role">Vai entrar como</Label>
              <Select name="role" defaultValue="MEMBER">
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Membro</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Membro: {ROLE_DESCRIPTION.MEMBER.toLowerCase()}. Admin:{" "}
                {ROLE_DESCRIPTION.ADMIN.toLowerCase()}.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Enviar por e-mail (opcional)</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="nome@email.com"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Se preencher, mandamos o código por e-mail. Se deixar em branco,
                você copia e envia como preferir.
              </p>
            </div>

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Gerando..." : "Gerar código"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
