"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addAllowedEmail } from "@/server/actions/allowlist";

export function AddAllowedEmailForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  function action(formData: FormData) {
    startTransition(async () => {
      const res = await addAllowedEmail(formData);
      if (res.ok) {
        toast.success("E-mail liberado.");
        formRef.current?.reset();
      } else {
        toast.error(res.error ?? "Erro ao salvar.");
      }
    });
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          name="email"
          type="email"
          required
          placeholder="email@exemplo.com"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
        />
        <select
          name="role"
          defaultValue="USER"
          className="h-10 rounded-md border border-input bg-background px-3 text-base md:text-sm"
        >
          <option value="USER">Usuário</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>
      <input
        name="note"
        type="text"
        placeholder="Observação (opcional)"
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
      />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        <Plus />
        {pending ? "Salvando..." : "Liberar e-mail"}
      </Button>
    </form>
  );
}
