import type { PrismaClient, BaseUnit } from "@prisma/client";

export type PurchasePrice = { quantity: number; pricePaidCents: number };

export function unitCostFromLastPurchase(last: PurchasePrice | null): number | null {
  if (!last || last.quantity <= 0) return null;
  return last.pricePaidCents / last.quantity;
}

export type LastPurchaseInfo = PurchasePrice & {
  unit: BaseUnit;
  purchasedAt: Date;
  supplierId: string | null;
};

export async function getLastPurchase(
  db: PrismaClient,
  itemId: string,
  supplierId?: string,
): Promise<LastPurchaseInfo | null> {
  const item = await db.purchaseItem.findFirst({
    where: {
      itemId,
      ...(supplierId ? { purchase: { supplierId } } : {}),
    },
    orderBy: { purchase: { purchasedAt: "desc" } },
    select: {
      quantity: true,
      unit: true,
      pricePaidCents: true,
      purchase: { select: { purchasedAt: true, supplierId: true } },
    },
  });
  if (!item) return null;

  return {
    quantity: item.quantity,
    unit: item.unit,
    pricePaidCents: item.pricePaidCents,
    purchasedAt: item.purchase.purchasedAt,
    supplierId: item.purchase.supplierId,
  };
}
