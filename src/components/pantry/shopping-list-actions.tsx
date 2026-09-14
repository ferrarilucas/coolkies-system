"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateAutoShoppingList } from "@/server/actions/shopping-list";

export function GenerateShoppingListButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    startTransition(async () => {
      const res = await generateAutoShoppingList();
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível gerar a lista.");
        return;
      }
      const { created, updated } = res.data ?? { created: 0, updated: 0 };
      if (created === 0 && updated === 0) {
        toast.info("Sua lista já está em dia.");
      } else {
        toast.success(`Lista atualizada: ${created} novo(s), ${updated} ajustado(s).`);
      }
      router.refresh();
    });
  }

  return (
    <Button onClick={onClick} disabled={pending} variant="outline" size="sm">
      <RefreshCw className="size-4" />
      {pending ? "Gerando..." : "Gerar lista de compras"}
    </Button>
  );
}
