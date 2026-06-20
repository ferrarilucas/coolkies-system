import { notFound } from "next/navigation";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { ProductionForm } from "@/components/production/production-form";
import { getProductionBatchById } from "@/server/queries/production";
import { db } from "@/lib/db";

export default async function EditProductionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [batch, products, flavors, recipes] = await Promise.all([
    getProductionBatchById(id),
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.flavor.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, productId: true, fillingRecipeId: true },
    }),
    db.recipe.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, yieldQty: true } }),
  ]);

  if (!batch) notFound();

  const initial = {
    productId: batch.productId,
    flavorId: batch.flavorId,
    recipeId: batch.recipeId,
    quantity: batch.quantity,
    notes: batch.notes ?? "",
    producedAt: format(batch.producedAt, "yyyy-MM-dd"),
    fillings: batch.fillings.map((f) => ({ flavorId: f.flavorId, quantity: f.quantity })),
  };

  return (
    <div>
      <PageHeader title="Editar produção" backHref="/products" />
      <ProductionForm
        batchId={id}
        products={products}
        flavors={flavors}
        recipes={recipes}
        initial={initial}
      />
    </div>
  );
}
