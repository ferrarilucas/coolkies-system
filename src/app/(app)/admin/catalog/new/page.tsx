import { PageHeader } from "@/components/shared/page-header";
import { ProductEditor } from "@/components/catalog/product-editor";
import { getWorkspaceDb } from "@/server/tenant/context";

export default async function NewProductPage() {
  const db = await getWorkspaceDb();
  const recipes = await db.recipe.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div>
      <PageHeader
        title="Novo produto"
        description="Nome, sabores e preços em um só lugar."
        backHref="/admin/catalog"
      />
      <ProductEditor product={null} recipes={recipes} />
    </div>
  );
}
