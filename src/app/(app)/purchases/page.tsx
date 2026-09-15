import { ShoppingBag } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getSuppliers, getPurchases } from "@/server/queries/purchases";
import { getWorkspaceDb } from "@/server/tenant/context";
import { PurchaseDialog } from "@/components/purchases/purchase-dialog";
import { SupplierDialog } from "@/components/purchases/supplier-dialog";
import { PurchasesList } from "@/components/purchases/purchases-list";
import { SuppliersList } from "@/components/purchases/suppliers-list";

export default async function PurchasesPage() {
  const db = await getWorkspaceDb();

  const [suppliers, purchases, ingredients] = await Promise.all([
    getSuppliers(),
    getPurchases(),
    db.ingredient.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, baseUnit: true, forResale: true },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Compras"
        description="Registre compras de matéria-prima ou itens para revenda."
        action={<PurchaseDialog suppliers={suppliers} ingredients={ingredients} />}
      />

      <Tabs defaultValue="purchases">
        <TabsList className="w-full sm:w-auto mb-4">
          <TabsTrigger value="purchases" className="flex-1 sm:flex-none">
            Compras
            {purchases.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                {purchases.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="flex-1 sm:flex-none">
            Fornecedores
            {suppliers.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                {suppliers.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="purchases">
          {purchases.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="Nenhuma compra registrada"
              description={
                ingredients.length === 0
                  ? "Registre sua primeira compra — você pode criar o insumo direto no formulário."
                  : "Registre sua primeira compra para calcular o custo das receitas e o lucro de itens revendidos."
              }
              action={<PurchaseDialog suppliers={suppliers} ingredients={ingredients} />}
            />
          ) : (
            <PurchasesList purchases={purchases} />
          )}
        </TabsContent>

        <TabsContent value="suppliers">
          <div className="flex justify-end mb-3">
            <SupplierDialog />
          </div>
          <SuppliersList suppliers={suppliers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
