import { summarize, type InstallmentPlan } from "@/lib/installments";
import { testDb } from "./db";

export async function seedParceledSale(input: {
  workspaceId: string;
  userId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  soldAt?: Date;
  parcels: { amountCents: number; dueDate: Date | null; paidAt?: Date | null }[];
}) {
  const plans: InstallmentPlan[] = input.parcels.map((p, idx) => ({
    number: idx + 1,
    amountCents: p.amountCents,
    dueDate: p.dueDate,
    forecastPreset: p.dueDate ? "CUSTOM" : null,
    paidAt: p.paidAt ?? null,
  }));
  const totalCents = plans.reduce((sum, p) => sum + p.amountCents, 0);
  return testDb.sale.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      customerId: input.customerId ?? null,
      customerName: input.customerName ?? null,
      soldAt: input.soldAt ?? new Date(),
      totalCents,
      ...summarize(plans),
      installments: { create: plans.map((p) => ({ ...p, workspaceId: input.workspaceId })) },
    },
    include: { installments: { orderBy: { number: "asc" } } },
  });
}
