import { PageHeader } from "@/components/shared/page-header";
import { ProductionForm } from "@/components/production/production-form";
import { db } from "@/lib/db";

export default async function NewProductionPage() {
  const [products, flavors, recipes] = await Promise.all([
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.flavor.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, productId: true, fillingRecipeId: true },
    }),
    db.recipe.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, yieldQty: true } }),
  ]);

  return (
    <div>
      <PageHeader title="Registrar produção" backHref="/products" />
      <ProductionForm products={products} flavors={flavors} recipes={recipes} />
    </div>
  );
}
