"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateMemberRole } from "@/server/actions/workspaces";

export function MemberRoleSelect({
  memberId,
  role,
}: {
  memberId: string;
  role: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onChange(value: string) {
    startTransition(async () => {
      const res = await updateMemberRole(memberId, value);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível alterar o papel.");
        return;
      }
      toast.success("Papel atualizado.");
      router.refresh();
    });
  }

  return (
    <Select value={role} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-8 w-[104px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="MEMBER">Membro</SelectItem>
        <SelectItem value="ADMIN">Admin</SelectItem>
      </SelectContent>
    </Select>
  );
}
