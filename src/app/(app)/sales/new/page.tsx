import { PageHeader } from "@/components/shared/page-header";
import { SaleForm } from "@/components/sales/sale-form";
import { getCatalogForSale } from "@/server/queries/sales";

export default async function NewSalePage() {
  const catalog = await getCatalogForSale();

  return (
    <div>
      <PageHeader title="Nova venda" backHref="/sales" />
      <SaleForm catalog={catalog} />
    </div>
  );
}
