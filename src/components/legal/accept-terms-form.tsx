"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acceptTerms } from "@/server/actions/account";

export function AcceptTermsForm() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, startTransition] = useTransition();

  function onAccept() {
    startTransition(async () => {
      const res = await acceptTerms();
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível registrar o aceite.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-4"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>
          Li e aceito os{" "}
          <Link href="/terms" target="_blank" className="underline underline-offset-4">Termos de uso</Link> e a{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-4">Política de privacidade</Link>.
        </span>
      </label>
      <Button className="w-full" disabled={!checked || pending} onClick={onAccept}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : "Continuar"}
      </Button>
    </div>
  );
}
