import { getWorkspaceDb } from "@/server/tenant/context";

export const CHARGE_IMAGE_MAX_IDS = 200;

export type ChargeSelection = {
  customer: { id: string; name: string; sector: string | null };
  sales: {
    id: string;
    soldAt: Date;
    totalCents: number;
    installmentCount: number;
    items: {
      id: string;
      quantity: number;
      productNameSnapshot: string;
      variantNameSnapshot: string | null;
    }[];
    selectedInstallments: { id: string; number: number; amountCents: number; dueDate: Date | null }[];
  }[];
  totalCents: number;
};

export type ChargeSelectionResult =
  | { status: "no-customer" }
  | { status: "empty" }
  | { status: "ok"; selection: ChargeSelection };

export async function getChargeSelection(
  customerId: string,
  installmentIds: string[],
): Promise<ChargeSelectionResult> {
  const db = await getWorkspaceDb();
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, sector: true },
  });
  if (!customer) return { status: "no-customer" };
  if (installmentIds.length === 0) return { status: "empty" };

  const installments = await db.saleInstallment.findMany({
    where: { id: { in: installmentIds }, paidAt: null, sale: { customerId } },
    orderBy: [{ sale: { soldAt: "asc" } }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      amountCents: true,
      dueDate: true,
      sale: {
        select: {
          id: true,
          soldAt: true,
          totalCents: true,
          installmentCount: true,
          items: {
            select: { id: true, quantity: true, productNameSnapshot: true, variantNameSnapshot: true },
          },
        },
      },
    },
  });
  if (installments.length === 0) return { status: "empty" };

  const sales = new Map<string, ChargeSelection["sales"][number]>();
  for (const { sale, ...installment } of installments) {
    const entry = sales.get(sale.id) ?? { ...sale, selectedInstallments: [] };
    entry.selectedInstallments.push(installment);
    sales.set(sale.id, entry);
  }

  return {
    status: "ok",
    selection: {
      customer,
      sales: [...sales.values()],
      totalCents: installments.reduce((sum, i) => sum + i.amountCents, 0),
    },
  };
}
