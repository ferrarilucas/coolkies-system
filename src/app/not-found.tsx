import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo variant="mark" className="mb-4 size-14" />
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
