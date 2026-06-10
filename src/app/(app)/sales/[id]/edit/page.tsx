import { notFound } from "next/navigation";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { SaleForm } from "@/components/sales/sale-form";
import { getSaleById, getCatalogForSale } from "@/server/queries/sales";

export default async function EditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [sale, catalog] = await Promise.all([getSaleById(id), getCatalogForSale()]);

  if (!sale) notFound();

  const initial = {
    customer: sale.customerId
      ? {
          id: sale.customerId,
          name: sale.customerName ?? "",
          email: null,
          phone: null,
          sector: null,
        }
      : null,
    soldAt: format(sale.soldAt, "yyyy-MM-dd"),
    notes: sale.notes ?? "",
    status: sale.status as "PAID" | "PENDING",
    forecastPreset: sale.forecastPreset ?? null,
    forecastDate: sale.paymentForecastDate
      ? format(sale.paymentForecastDate, "yyyy-MM-dd")
      : null,
    items: sale.items.map((i) => ({
      productId: i.productId,
      productName: i.productNameSnapshot,
      flavorId: i.flavorId,
      flavorName: i.flavorNameSnapshot,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceSnapshot,
    })),
  };

  return (
    <div>
      <PageHeader
        title="Editar venda"
        description={sale.customerName ? `Cliente: ${sale.customerName}` : undefined}
        backHref="/sales"
      />
      <SaleForm saleId={sale.id} catalog={catalog} initial={initial} />
    </div>
  );
}
