import type { ForecastPreset, Prisma } from "@prisma/client";
import { summarize, type InstallmentPlan } from "@/lib/installments";

type InstallmentRow = {
  number: number;
  amountCents: number;
  dueDate: Date | null;
  forecastPreset: ForecastPreset | null;
  paidAt: Date | null;
};

export function toPlans(rows: InstallmentRow[]): InstallmentPlan[] {
  return rows.map(({ number, amountCents, dueDate, forecastPreset, paidAt }) => ({
    number,
    amountCents,
    dueDate,
    forecastPreset,
    paidAt,
  }));
}

export function dueByWhere(cutoff: Date): Prisma.SaleInstallmentWhereInput {
  return { OR: [{ dueDate: { lte: cutoff } }, { dueDate: null }] };
}

export async function writeInstallments(
  tx: Prisma.TransactionClient,
  saleId: string,
  workspaceId: string,
  plans: InstallmentPlan[],
): Promise<void> {
  await tx.saleInstallment.deleteMany({ where: { saleId } });
  await tx.saleInstallment.createMany({
    data: plans.map((plan) => ({ ...plan, saleId, workspaceId })),
  });
  await tx.sale.update({ where: { id: saleId }, data: summarize(plans) });
}

export async function syncSaleSummary(tx: Prisma.TransactionClient, saleIds: string[]): Promise<void> {
  const rows = await tx.saleInstallment.findMany({
    where: { saleId: { in: saleIds } },
    orderBy: { number: "asc" },
  });
  for (const saleId of saleIds) {
    const plans = toPlans(rows.filter((row) => row.saleId === saleId));
    await tx.sale.update({ where: { id: saleId }, data: summarize(plans) });
  }
}
