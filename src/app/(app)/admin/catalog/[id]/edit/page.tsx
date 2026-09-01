import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ProductEditor } from "@/components/catalog/product-editor";
import { getProductForEdit } from "@/server/queries/catalog";
import { getWorkspaceDb } from "@/server/tenant/context";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getWorkspaceDb();
  const [product, recipes] = await Promise.all([
    getProductForEdit(id),
    db.recipe.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  if (!product) notFound();

  return (
    <div>
      <PageHeader
        title={product.name}
        description="Sabores e preços deste produto."
        backHref="/admin/catalog"
      />
      <ProductEditor product={product} recipes={recipes} />
    </div>
  );
}
