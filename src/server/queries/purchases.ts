import { getWorkspaceDb } from "@/server/tenant/context";

export type SupplierItem = Awaited<ReturnType<typeof getSuppliers>>[number];

export async function getSuppliers() {
  const db = await getWorkspaceDb();
  return db.supplier.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { purchases: true } } },
  });
}

export type PurchaseListItem = Awaited<ReturnType<typeof getPurchases>>[number];

export async function getPurchases() {
  const db = await getWorkspaceDb();
  return db.purchase.findMany({
    orderBy: { purchasedAt: "desc" },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: {
          item: { select: { id: true, name: true, unit: true } },
          variant: { select: { id: true, name: true } },
        },
      },
    },
  });
}
