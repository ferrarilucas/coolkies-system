import { Tags, Package, Palette, DollarSign } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getProductsWithFlavorsAndPrices } from "@/server/queries/catalog";
import { getWorkspaceDb } from "@/server/tenant/context";
import { ProductDialog } from "@/components/catalog/product-dialog";
import { FlavorDialog } from "@/components/catalog/flavor-dialog";
import { PriceDialog } from "@/components/catalog/price-dialog";
import { ActiveToggle } from "@/components/catalog/active-toggle";
import { formatBRL } from "@/lib/money";

export default async function CatalogPage() {
  const db = await getWorkspaceDb();

  const [products, recipes] = await Promise.all([
    getProductsWithFlavorsAndPrices(),
    db.recipe.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const allFlavors = products.flatMap((p) =>
    p.flavors.map((f) => ({ ...f, productName: p.name })),
  );

  const allPrices = products.flatMap((p) => [
    ...p.priceListItems.map((pr) => ({
      ...pr,
      productName: p.name,
      flavorName: null as string | null,
    })),
    ...p.flavors.flatMap((f) =>
      f.priceListItems.map((pr) => ({
        ...pr,
        productName: p.name,
        flavorName: f.name,
      })),
    ),
  ]);

  const productsForDialogs = products.map((p) => ({
    id: p.id,
    name: p.name,
    flavors: p.flavors.map((f) => ({ id: f.id, name: f.name })),
  }));

  return (
    <div>
      <PageHeader
        title="Valores"
        description="Produtos, sabores e preços de venda."
        backHref="/admin"
      />

      <Tabs defaultValue="products">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="products" className="flex-1 sm:flex-none gap-1.5">
            <Package className="size-3.5" />
            Produtos
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {products.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="flavors" className="flex-1 sm:flex-none gap-1.5">
            <Palette className="size-3.5" />
            Sabores
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {allFlavors.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="prices" className="flex-1 sm:flex-none gap-1.5">
            <DollarSign className="size-3.5" />
            Preços
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {allPrices.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ─── Produtos ─── */}
        <TabsContent value="products">
          <div className="mb-4 flex justify-end">
            <ProductDialog mode="create" />
          </div>

          {products.length === 0 ? (
            <EmptyState
              icon={Tags}
              title="Nenhum produto"
              description="Cadastre o primeiro produto para começar."
              action={<ProductDialog mode="create" />}
            />
          ) : (
            <div className="space-y-2">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between rounded-lg border bg-card p-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{product.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {product.flavors.length} sabor{product.flavors.length !== 1 ? "es" : ""}
                    </span>
                    {!product.active && (
                      <Badge variant="secondary" className="text-xs">Inativo</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <ActiveToggle entity="product" id={product.id} active={product.active} />
                    <ProductDialog mode="edit" product={{ id: product.id, name: product.name }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── Sabores ─── */}
        <TabsContent value="flavors">
          <div className="mb-4 flex justify-end">
            <FlavorDialog mode="create" products={productsForDialogs} recipes={recipes} />
          </div>

          {allFlavors.length === 0 ? (
            <EmptyState
              icon={Palette}
              title="Nenhum sabor"
              description="Cadastre os sabores dos seus produtos."
              action={<FlavorDialog mode="create" products={productsForDialogs} />}
            />
          ) : (
            <div className="space-y-4">
              {products.map((product) => {
                if (product.flavors.length === 0) return null;
                return (
                  <div key={product.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        {product.name}
                      </span>
                      <Separator className="flex-1" />
                      <FlavorDialog
                        mode="create"
                        products={productsForDialogs}
                        defaultProductId={product.id}
                      />
                    </div>
                    <div className="space-y-2">
                      {product.flavors.map((flavor) => (
                        <div
                          key={flavor.id}
                          className="flex items-center justify-between rounded-lg border bg-card p-4"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-medium">{flavor.name}</span>
                            {!flavor.active && (
                              <Badge variant="secondary" className="text-xs">Inativo</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <ActiveToggle entity="flavor" id={flavor.id} active={flavor.active} />
                            <FlavorDialog
                              mode="edit"
                              products={productsForDialogs}
                              recipes={recipes}
                              flavor={{
                                id: flavor.id,
                                name: flavor.name,
                                productId: flavor.productId,
                                fillingRecipeId: flavor.fillingRecipeId ?? null,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── Preços ─── */}
        <TabsContent value="prices">
          <div className="mb-4 flex justify-end">
            <PriceDialog mode="create" products={productsForDialogs} />
          </div>

          {allPrices.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="Nenhum preço cadastrado"
              description="Defina os preços de venda dos seus produtos e sabores."
              action={<PriceDialog mode="create" products={productsForDialogs} />}
            />
          ) : (
            <div className="space-y-4">
              {products.map((product) => {
                const productPrices = allPrices.filter((p) => p.productId === product.id);
                if (productPrices.length === 0) return null;
                return (
                  <div key={product.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        {product.name}
                      </span>
                      <Separator className="flex-1" />
                    </div>
                    <div className="space-y-2">
                      {productPrices.map((price) => (
                        <div
                          key={price.id}
                          className="flex items-center justify-between rounded-lg border bg-card p-4"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-medium">
                              {price.flavorName ?? (
                                <span className="text-muted-foreground italic">Genérico</span>
                              )}
                            </span>
                            <span className="tabular-nums font-semibold text-primary">
                              {formatBRL(price.priceCents)}
                            </span>
                            {price.history.length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                (era {formatBRL(price.history[0].priceCents)})
                              </span>
                            )}
                            {!price.active && (
                              <Badge variant="secondary" className="text-xs">Inativo</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <ActiveToggle entity="price" id={price.id} active={price.active} />
                            <PriceDialog
                              mode="edit"
                              products={productsForDialogs}
                              price={{
                                id: price.id,
                                priceCents: price.priceCents,
                                productId: price.productId,
                                flavorId: price.flavorId,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
