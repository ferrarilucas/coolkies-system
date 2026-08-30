import { Store } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getMarkets, getPurchases } from "@/server/queries/markets";
import { getWorkspaceDb } from "@/server/tenant/context";
import { PurchaseDialog } from "@/components/markets/purchase-dialog";
import { MarketDialog } from "@/components/markets/market-dialog";
import { PurchasesList } from "@/components/markets/purchases-list";
import { MarketsList } from "@/components/markets/markets-list";

export default async function MarketsPage() {
  const db = await getWorkspaceDb();

  const [markets, purchases, ingredients] = await Promise.all([
    getMarkets(),
    getPurchases(),
    db.ingredient.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const hasMarkets = markets.length > 0;
  const hasIngredients = ingredients.length > 0;
  const canRegister = hasMarkets && hasIngredients;

  return (
    <div>
      <PageHeader
        title="Mercados e preços"
        description="Registre compras e acompanhe o custo dos ingredientes."
        action={
          canRegister ? (
            <PurchaseDialog markets={markets} ingredients={ingredients} />
          ) : (
            <MarketDialog />
          )
        }
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
          <TabsTrigger value="markets" className="flex-1 sm:flex-none">
            Mercados
            {markets.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                {markets.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Tab: Compras */}
        <TabsContent value="purchases">
          {purchases.length === 0 ? (
            <EmptyState
              icon={Store}
              title="Nenhuma compra registrada"
              description={
                !hasMarkets
                  ? "Cadastre um mercado primeiro para poder registrar compras."
                  : !hasIngredients
                    ? "Cadastre ingredientes em Cadastros > Ingredientes para registrar compras."
                    : "Registre sua primeira compra para calcular o custo das receitas."
              }
              action={canRegister ? (
                <PurchaseDialog markets={markets} ingredients={ingredients} />
              ) : undefined}
            />
          ) : (
            <PurchasesList purchases={purchases} />
          )}
        </TabsContent>

        {/* Tab: Mercados */}
        <TabsContent value="markets">
          <div className="flex justify-end mb-3">
            <MarketDialog />
          </div>
          <MarketsList markets={markets} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
