"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { StockMovementType } from "@prisma/client";
import { parsePaymentChoice, planPayment, type PaymentFields } from "@/lib/installments";
import { toPlans, writeInstallments } from "@/server/sales/installments";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

// ─── Tipos internos ──────────────────────────────────────────────────────────

type SaleItemInput = {
  itemId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  quantity: number;
  unitPriceCents: number;
};

type DiscountType = "PERCENTAGE" | "FIXED";

function calcDiscountCents(subtotal: number, type: DiscountType | null, value: number): number {
  if (!type || value <= 0) return 0;
  if (type === "PERCENTAGE") return Math.round(subtotal * value / 100);
  return Math.min(value, subtotal);
}

function parseDiscount(formData: FormData): { discountType: DiscountType | null; discountValue: number } {
  const raw = String(formData.get("discountType") ?? "").trim();
  const discountType = (raw === "PERCENTAGE" || raw === "FIXED") ? raw as DiscountType : null;
  const discountValue = discountType ? Math.max(0, parseInt(String(formData.get("discountValue") ?? "0")) || 0) : 0;
  return { discountType, discountValue };
}

function readPaymentFields(formData: FormData): PaymentFields {
  const dateRaw = String(formData.get("forecastDate") ?? "").trim();
  return {
    mode: String(formData.get("paymentMode") ?? "CASH"),
    status: String(formData.get("status") ?? "PAID"),
    count: parseInt(String(formData.get("installmentCount") ?? "1"), 10) || 1,
    preset: String(formData.get("forecastPreset") ?? ""),
    dueDate: dateRaw ? new Date(`${dateRaw}T12:00:00`) : null,
  };
}

function saleItemsCreate(items: SaleItemInput[], workspaceId: string) {
  return items.map((item) => ({
    itemId: item.itemId,
    productNameSnapshot: item.productName,
    variantId: item.variantId,
    variantNameSnapshot: item.variantName,
    quantity: item.quantity,
    unitPriceSnapshot: item.unitPriceCents,
    workspaceId,
  }));
}

// ─── Criar venda ─────────────────────────────────────────────────────────────

export async function createSale(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { db, workspaceId, userId } = await getScopedDb();
  await assertCanWrite();

  const customerId = String(formData.get("customerId") ?? "").trim() || null;
  const customerName = String(formData.get("customerName") ?? "").trim() || null;
  const soldAtRaw = String(formData.get("soldAt") ?? "").trim();
  const soldAt = soldAtRaw ? new Date(`${soldAtRaw}T12:00:00`) : new Date();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const choice = parsePaymentChoice(readPaymentFields(formData));
  if ("error" in choice) return { ok: false, error: choice.error };

  const { discountType, discountValue } = parseDiscount(formData);

  const itemsRaw = String(formData.get("items") ?? "[]");
  let items: SaleItemInput[] = [];
  try {
    items = JSON.parse(itemsRaw) as SaleItemInput[];
  } catch {
    return { ok: false, error: "Itens inválidos." };
  }

  if (items.length === 0) return { ok: false, error: "Adicione pelo menos um item." };

  const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
  const discountCents = calcDiscountCents(subtotalCents, discountType, discountValue);
  const totalCents = subtotalCents - discountCents;

  const plan = planPayment(choice, totalCents, [], new Date());
  if (!plan.ok) return { ok: false, error: plan.error };

  try {
    const sale = await db.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          userId,
          customerId,
          customerName,
          soldAt,
          notes,
          discountType,
          discountValue,
          totalCents,
          workspaceId,
          items: { create: saleItemsCreate(items, workspaceId) },
        },
      });
      for (const item of items) {
        await tx.stockMovement.create({
          data: {
            itemId: item.itemId,
            variantId: item.variantId,
            type: StockMovementType.SALE,
            quantity: -item.quantity,
            saleId: created.id,
            workspaceId,
          },
        });
      }
      await writeInstallments(tx, created.id, workspaceId, plan.installments);
      return created;
    });

    revalidatePath("/sales");
    revalidatePath("/stock");
    return { ok: true, data: { id: sale.id } };
  } catch (e) {
    console.error("createSale error:", e);
    return { ok: false, error: "Erro ao registrar venda." };
  }
}

// ─── Atualizar venda ─────────────────────────────────────────────────────────

export async function updateSale(id: string, formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb();
  await assertCanWrite();

  const customerId = String(formData.get("customerId") ?? "").trim() || null;
  const customerName = String(formData.get("customerName") ?? "").trim() || null;
  const soldAtRaw = String(formData.get("soldAt") ?? "").trim();
  const soldAt = soldAtRaw ? new Date(`${soldAtRaw}T12:00:00`) : new Date();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const choice = parsePaymentChoice(readPaymentFields(formData));
  if ("error" in choice) return { ok: false, error: choice.error };

  const { discountType, discountValue } = parseDiscount(formData);

  const itemsRaw = String(formData.get("items") ?? "[]");
  let items: SaleItemInput[] = [];
  try {
    items = JSON.parse(itemsRaw) as SaleItemInput[];
  } catch {
    return { ok: false, error: "Itens inválidos." };
  }
  if (items.length === 0) return { ok: false, error: "Adicione pelo menos um item." };

  const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
  const discountCents = calcDiscountCents(subtotalCents, discountType, discountValue);
  const totalCents = subtotalCents - discountCents;

  const existing = await db.saleInstallment.findMany({ where: { saleId: id }, orderBy: { number: "asc" } });
  const plan = planPayment(choice, totalCents, toPlans(existing), new Date());
  if (!plan.ok) return { ok: false, error: plan.error };

  try {
    await db.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { saleId: id } });
      await tx.saleItem.deleteMany({ where: { saleId: id } });
      await tx.sale.update({
        where: { id },
        data: {
          customerId,
          customerName,
          soldAt,
          notes,
          discountType,
          discountValue,
          totalCents,
          items: { create: saleItemsCreate(items, workspaceId) },
        },
      });
      for (const item of items) {
        await tx.stockMovement.create({
          data: {
            itemId: item.itemId,
            variantId: item.variantId,
            type: StockMovementType.SALE,
            quantity: -item.quantity,
            saleId: id,
            workspaceId,
          },
        });
      }
      await writeInstallments(tx, id, workspaceId, plan.installments);
    });

    revalidatePath("/sales");
    revalidatePath("/stock");
    return { ok: true };
  } catch (e) {
    console.error("updateSale error:", e);
    return { ok: false, error: "Erro ao atualizar venda." };
  }
}


// ─── Marcar como pago ────────────────────────────────────────────────────────

export async function markAsPaid(
  id: string,
): Promise<ActionResult<{ forecastDate: string | null; forecastPreset: string | null }>> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  const sale = await db.sale.findUnique({
    where: { id },
    select: { paymentForecastDate: true, forecastPreset: true },
  });
  if (!sale) return { ok: false, error: "Venda não encontrada." };

  await db.sale.update({
    where: { id },
    data: { status: "PAID", paidAt: new Date(), paymentForecastDate: null, forecastPreset: null },
  });
  revalidatePath("/sales");
  return {
    ok: true,
    data: {
      forecastDate: sale.paymentForecastDate?.toISOString() ?? null,
      forecastPreset: sale.forecastPreset ?? null,
    },
  };
}

export async function markCustomerSalesAsPaid(
  customerId: string,
): Promise<ActionResult<{ count: number; totalCents: number }>> {
  const { db } = await getScopedDb();
  await assertCanWrite();

  const pending = await db.sale.aggregate({
    where: { customerId, status: "PENDING" },
    _sum: { totalCents: true },
    _count: { _all: true },
  });
  const count = pending._count._all;
  if (count === 0) {
    return { ok: false, error: "Nenhuma venda pendente para este cliente." };
  }

  await db.sale.updateMany({
    where: { customerId, status: "PENDING" },
    data: { status: "PAID", paidAt: new Date(), paymentForecastDate: null, forecastPreset: null },
  });

  revalidatePath("/sales");
  revalidatePath("/dashboard");
  return {
    ok: true,
    data: { count, totalCents: pending._sum.totalCents ?? 0 },
  };
}

export async function markSalesAsPaid(
  saleIds: string[],
): Promise<ActionResult<{ count: number; totalCents: number }>> {
  if (saleIds.length === 0) {
    return { ok: false, error: "Selecione ao menos uma venda." };
  }

  const { db } = await getScopedDb();
  await assertCanWrite();

  const pending = await db.sale.aggregate({
    where: { id: { in: saleIds }, status: "PENDING" },
    _sum: { totalCents: true },
    _count: { _all: true },
  });
  const count = pending._count._all;
  if (count === 0) {
    return { ok: false, error: "Nenhuma venda pendente selecionada." };
  }

  await db.sale.updateMany({
    where: { id: { in: saleIds }, status: "PENDING" },
    data: { status: "PAID", paidAt: new Date(), paymentForecastDate: null, forecastPreset: null },
  });

  revalidatePath("/sales");
  revalidatePath("/customers");
  revalidatePath("/dashboard");
  return { ok: true, data: { count, totalCents: pending._sum.totalCents ?? 0 } };
}

export async function markAsPending(
  id: string,
  forecastDate: string | null,
  forecastPreset: string | null,
): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  try {
    await db.sale.update({
      where: { id },
      data: {
        status: "PENDING",
        paidAt: null,
        paymentForecastDate: forecastDate ? new Date(forecastDate) : null,
        forecastPreset: forecastPreset as "DAY_FIVE" | "FIFTH_BUSINESS_DAY" | "CUSTOM" | null,
      },
    });
  } catch {
    return { ok: false, error: "Não foi possível desfazer." };
  }
  revalidatePath("/sales");
  return { ok: true };
}

// ─── Excluir venda ───────────────────────────────────────────────────────────

export async function deleteSale(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  try {
    await db.stockMovement.deleteMany({ where: { saleId: id } });
    await db.sale.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
  revalidatePath("/sales");
  revalidatePath("/stock");
  return { ok: true };
}
