import Link from "next/link";
import { Boxes, ListChecks, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function StockPage() {
  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Saldo de cookies e ingredientes."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/stock/shopping-list">
              <ListChecks />
              Lista de compras
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Produção de cookies</CardTitle>
          <Button size="sm">
            <Plus />
            Registrar produção
          </Button>
        </CardHeader>
        <CardContent>
          {/* TODO: form "fiz X cookies do sabor Y" -> ProductionBatch + StockMovement(+) */}
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Boxes className="size-4" />
            Saldo atual = produção − vendas ± ajustes. Em breve.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
