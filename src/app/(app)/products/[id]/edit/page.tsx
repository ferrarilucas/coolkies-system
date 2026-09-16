import { notFound } from "next/navigation";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { ProductionForm } from "@/components/production/production-form";
import { getProductionBatchById } from "@/server/queries/production";
import { getWorkspaceDb } from "@/server/tenant/context";

export default async function EditProductionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getWorkspaceDb();

  const [batch, items, variants, recipes] = await Promise.all([
    getProductionBatchById(id),
    db.item.findMany({ where: { active: true, sellable: true }, orderBy: { name: "asc" } }),
    db.variant.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, itemId: true, recipeId: true },
    }),
    db.recipe.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, yieldQty: true } }),
  ]);

  if (!batch) notFound();

  const initial = {
    itemId: batch.itemId,
    recipeId: batch.recipeId,
    quantity: batch.quantity,
    notes: batch.notes ?? "",
    producedAt: format(batch.producedAt, "yyyy-MM-dd"),
    fillings: batch.variantLines.map((f) => ({ variantId: f.variantId, quantity: f.quantity })),
  };

  return (
    <div>
      <PageHeader title="Editar produção" backHref="/products" />
      <ProductionForm
        batchId={id}
        items={items}
        variants={variants}
        recipes={recipes}
        initial={initial}
      />
    </div>
  );
}
