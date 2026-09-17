import { PageHeader } from "@/components/shared/page-header";
import { ProductionForm } from "@/components/production/production-form";
import { getWorkspaceDb } from "@/server/tenant/context";

export default async function NewProductionPage() {
  const db = await getWorkspaceDb();

  const [items, variants, recipes] = await Promise.all([
    db.item.findMany({ where: { active: true, sellable: true }, orderBy: { name: "asc" } }),
    db.variant.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, itemId: true, recipeId: true },
    }),
    db.recipe.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, yieldQty: true } }),
  ]);

  return (
    <div>
      <PageHeader title="Registrar produção" backHref="/products" />
      <ProductionForm items={items} variants={variants} recipes={recipes} />
    </div>
  );
}
