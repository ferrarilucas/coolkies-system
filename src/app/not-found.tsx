import Link from "next/link";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
        <Cookie className="size-7 text-primary" />
      </div>
      <h1 className="text-lg font-semibold">Página não encontrada</h1>
      <p className="mb-6 mt-1 max-w-sm text-sm text-muted-foreground">
        O endereço que você acessou não existe ou foi movido.
      </p>
      <Button asChild>
        <Link href="/dashboard">Ir para o painel</Link>
      </Button>
    </div>
  );
}
