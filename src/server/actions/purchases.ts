"use server";

import { revalidatePath } from "next/cache";
import { StockMovementType, type BaseUnit } from "@prisma/client";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { normalizeName } from "@/lib/text";
import { toBaseUnit, type InputUnit } from "@/lib/units";
import { getLastPurchase } from "@/server/queries/purchase-cost";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

// ─── Fornecedores ────────────────────────────────────────────────────────────

export async function createSupplierInline(
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  const { db, workspaceId } = await getScopedDb();
  await assertCanWrite();
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!name) return { ok: false, error: "Nome é obrigatório." };

  try {
    const supplier = await db.supplier.create({ data: { name, workspaceId } });
    revalidatePath("/purchases");
    return { ok: true, data: { id: supplier.id, name: supplier.name } };
  } catch {
    return { ok: false, error: "Já existe um fornecedor com esse nome." };
  }
}

export async function updateSupplier(id: string, formData: FormData): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!name) return { ok: false, error: "Nome é obrigatório." };

  try {
    await db.supplier.update({ where: { id }, data: { name } });
    revalidatePath("/purchases");
    return { ok: true };
  } catch {
    return { ok: false, error: "Já existe um fornecedor com esse nome." };
  }
}

export async function deleteSupplier(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  try {
    await db.supplier.delete({ where: { id } });
    revalidatePath("/purchases");
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
}

// ─── Compras ──────────────────────────────────────────────────────────────────

type PurchaseItemInput = {
  itemId: string;
  quantity: number;
  unit: InputUnit;
  pricePaidCents: number;
};

export async function createPurchase(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId, userId } = await getScopedDb();
  await assertCanWrite();

  const supplierId = String(formData.get("supplierId") ?? "").trim() || null;
  const purchasedAtRaw = String(formData.get("purchasedAt") ?? "").trim();
  const purchasedAt = purchasedAtRaw ? new Date(`${purchasedAtRaw}T12:00:00`) : new Date();

  let items: PurchaseItemInput[];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]")) as PurchaseItemInput[];
  } catch {
    return { ok: false, error: "Itens inválidos." };
  }
  if (items.length === 0) return { ok: false, error: "Adicione ao menos um item." };
  for (const item of items) {
    if (!item.itemId) return { ok: false, error: "Selecione o item em todos os itens." };
    if (!item.quantity || item.quantity <= 0) return { ok: false, error: "Quantidade inválida em algum item." };
    if (!item.pricePaidCents || item.pricePaidCents <= 0) {
      return { ok: false, error: "Informe o preço pago em todos os itens." };
    }
  }

  const catalogItems = await db.item.findMany({
    where: { id: { in: items.map((i) => i.itemId) } },
    select: { id: true, unit: true },
  });
  const itemMap = new Map(catalogItems.map((i) => [i.id, i]));

  try {
    await db.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          supplierId,
          userId,
          purchasedAt,
          workspaceId,
          items: {
            create: items.map((line) => {
              const catalogItem = itemMap.get(line.itemId);
              const { quantity, unit } = toBaseUnit(line.quantity, line.unit, catalogItem?.unit);
              return { itemId: line.itemId, quantity, unit, pricePaidCents: line.pricePaidCents, workspaceId };
            }),
          },
        },
        include: { items: true },
      });

      for (const line of created.items) {
        await tx.stockMovement.create({
          data: {
            itemId: line.itemId,
            type: StockMovementType.PURCHASE,
            quantity: Math.round(line.quantity),
            purchaseId: created.id,
            workspaceId,
          },
        });
      }
    });
  } catch {
    return { ok: false, error: "Não foi possível registrar a compra." };
  }

  revalidatePath("/purchases");
  revalidatePath("/stock");
  return { ok: true };
}

export async function deletePurchase(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  await db.stockMovement.deleteMany({ where: { purchaseId: id } });
  await db.purchase.delete({ where: { id } });
  revalidatePath("/purchases");
  revalidatePath("/stock");
  return { ok: true };
}

// ─── Preço lembrado (autopreenchimento) ──────────────────────────────────────

export async function fetchLastPriceForSupplierItem(
  supplierId: string | null,
  itemId: string,
): Promise<{ quantity: number; unit: BaseUnit; pricePaidCents: number } | null> {
  const { db } = await getScopedDb();
  const last = await getLastPurchase(db, itemId, supplierId ?? undefined);
  if (!last) return null;
  return { quantity: last.quantity, unit: last.unit, pricePaidCents: last.pricePaidCents };
}
