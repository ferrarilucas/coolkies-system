"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { StockMovementType } from "@prisma/client";
import { parsePaymentChoice, planPayment, type PaymentFields } from "@/lib/installments";
import { syncSaleSummary, toPlans, writeInstallments } from "@/server/sales/installments";

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

function revalidatePayments() {
  revalidatePath("/sales");
  revalidatePath("/customers");
  revalidatePath("/dashboard");
}

export async function payInstallments(
  installmentIds: string[],
): Promise<ActionResult<{ count: number; totalCents: number }>> {
  if (installmentIds.length === 0) return { ok: false, error: "Selecione ao menos uma parcela." };

  const { db } = await getScopedDb();
  await assertCanWrite();

  const open = await db.saleInstallment.findMany({
    where: { id: { in: installmentIds }, paidAt: null },
    select: { id: true, saleId: true, amountCents: true },
  });
  if (open.length === 0) return { ok: false, error: "Nenhuma parcela em aberto selecionada." };

  await db.$transaction(async (tx) => {
    await tx.saleInstallment.updateMany({
      where: { id: { in: open.map((i) => i.id) }, paidAt: null },
      data: { paidAt: new Date() },
    });
    await syncSaleSummary(tx, [...new Set(open.map((i) => i.saleId))]);
  });

  revalidatePayments();
  return {
    ok: true,
    data: {
      count: open.length,
      totalCents: open.reduce((sum, i) => sum + i.amountCents, 0),
    },
  };
}

export async function unpayInstallments(installmentIds: string[]): Promise<ActionResult> {
  if (installmentIds.length === 0) return { ok: false, error: "Selecione ao menos uma parcela." };

  const { db } = await getScopedDb();
  await assertCanWrite();

  const paid = await db.saleInstallment.findMany({
    where: { id: { in: installmentIds }, paidAt: { not: null } },
    select: { id: true, saleId: true },
  });
  if (paid.length === 0) return { ok: false, error: "Não foi possível desfazer." };

  await db.$transaction(async (tx) => {
    await tx.saleInstallment.updateMany({
      where: { id: { in: paid.map((i) => i.id) } },
      data: { paidAt: null },
    });
    await syncSaleSummary(tx, [...new Set(paid.map((i) => i.saleId))]);
  });

  revalidatePayments();
  return { ok: true };
}

export async function payNextInstallment(
  saleId: string,
): Promise<ActionResult<{ installmentId: string; number: number; installmentCount: number; amountCents: number }>> {
  const { db } = await getScopedDb();
  await assertCanWrite();

  const next = await db.saleInstallment.findFirst({
    where: { saleId, paidAt: null },
    orderBy: { number: "asc" },
    select: { id: true, number: true, amountCents: true, sale: { select: { installmentCount: true } } },
  });
  if (!next) return { ok: false, error: "Esta venda não tem parcela em aberto." };

  const res = await payInstallments([next.id]);
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    data: {
      installmentId: next.id,
      number: next.number,
      installmentCount: next.sale.installmentCount,
      amountCents: next.amountCents,
    },
  };
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
