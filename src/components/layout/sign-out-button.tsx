"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    await signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      className="w-full text-destructive hover:text-destructive"
      onClick={handleClick}
      disabled={pending}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      Sair da conta
    </Button>
  );
}
