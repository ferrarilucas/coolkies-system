"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  toggleProductActive,
  toggleFlavorActive,
  togglePriceActive,
} from "@/server/actions/catalog";

type Entity = "product" | "flavor" | "price";

interface Props {
  entity: Entity;
  id: string;
  active: boolean;
}

export function ActiveToggle({ entity, id, active }: Props) {
  const [pending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      const action =
        entity === "product"
          ? toggleProductActive
          : entity === "flavor"
            ? toggleFlavorActive
            : togglePriceActive;

      const res = await action(id, checked);
      if (!res.ok) toast.error("Erro ao atualizar.");
    });
  }

  return (
    <Switch
      checked={active}
      onCheckedChange={handleChange}
      disabled={pending}
      aria-label={active ? "Desativar" : "Ativar"}
    />
  );
}
