"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { StockMovementType } from "@prisma/client";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Não autenticado");
  return session.user as { id: string; role?: string };
}

// ─── Tipos internos ──────────────────────────────────────────────────────────

type SaleItemInput = {
  productId: string;
  productName: string;
  flavorId: string | null;
  flavorName: string | null;
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

// ─── Criar venda ─────────────────────────────────────────────────────────────

export async function createSale(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireSession();

  const customerId = String(formData.get("customerId") ?? "").trim() || null;
  const customerName = String(formData.get("customerName") ?? "").trim() || null;
  const soldAtRaw = String(formData.get("soldAt") ?? "").trim();
  const soldAt = soldAtRaw ? new Date(`${soldAtRaw}T12:00:00`) : new Date();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "PAID") as "PAID" | "PENDING";
  const forecastPreset =
    (String(formData.get("forecastPreset") ?? "") as "DAY_FIVE" | "FIFTH_BUSINESS_DAY" | "CUSTOM" | "") || null;
  const forecastDateRaw = String(formData.get("forecastDate") ?? "").trim();
  const paymentForecastDate = forecastDateRaw ? new Date(`${forecastDateRaw}T12:00:00`) : null;

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

  try {
    // Cria a venda com os itens
    const sale = await db.sale.create({
      data: {
        userId: user.id,
        customerId,
        customerName,
        soldAt,
        notes,
        status,
        paidAt: status === "PAID" ? new Date() : null,
        paymentForecastDate: status === "PENDING" ? paymentForecastDate : null,
        forecastPreset: status === "PENDING" && forecastPreset ? forecastPreset : null,
        discountType,
        discountValue,
        totalCents,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            productNameSnapshot: item.productName,
            flavorId: item.flavorId,
            flavorNameSnapshot: item.flavorName,
            quantity: item.quantity,
            unitPriceSnapshot: item.unitPriceCents,
          })),
        },
      },
    });

    // Cria movimentos de estoque sequencialmente
    for (const item of items) {
      await db.stockMovement.create({
        data: {
          productId: item.productId,
          flavorId: item.flavorId,
          type: StockMovementType.SALE,
          quantity: -item.quantity,
          saleId: sale.id,
        },
      });
    }

    revalidatePath("/sales");
    return { ok: true, data: { id: sale.id } };
  } catch (e) {
    console.error("createSale error:", e);
    return { ok: false, error: "Erro ao registrar venda." };
  }
}

// ─── Atualizar venda ─────────────────────────────────────────────────────────

export async function updateSale(id: string, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const customerId = String(formData.get("customerId") ?? "").trim() || null;
  const customerName = String(formData.get("customerName") ?? "").trim() || null;
  const soldAtRaw = String(formData.get("soldAt") ?? "").trim();
  const soldAt = soldAtRaw ? new Date(`${soldAtRaw}T12:00:00`) : new Date();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "PAID") as "PAID" | "PENDING";
  const forecastPreset =
    (String(formData.get("forecastPreset") ?? "") as "DAY_FIVE" | "FIFTH_BUSINESS_DAY" | "CUSTOM" | "") || null;
  const forecastDateRaw = String(formData.get("forecastDate") ?? "").trim();
  const paymentForecastDate = forecastDateRaw ? new Date(`${forecastDateRaw}T12:00:00`) : null;

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

  try {
    // Remove movimentos e itens antigos
    await db.stockMovement.deleteMany({ where: { saleId: id } });
    await db.saleItem.deleteMany({ where: { saleId: id } });

    // Atualiza a venda e recria os itens
    await db.sale.update({
      where: { id },
      data: {
        customerId,
        customerName,
        soldAt,
        notes,
        status,
        paidAt: status === "PAID" ? new Date() : null,
        paymentForecastDate: status === "PENDING" ? paymentForecastDate : null,
        forecastPreset: status === "PENDING" && forecastPreset ? forecastPreset : null,
        discountType,
        discountValue,
        totalCents,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            productNameSnapshot: item.productName,
            flavorId: item.flavorId,
            flavorNameSnapshot: item.flavorName,
            quantity: item.quantity,
            unitPriceSnapshot: item.unitPriceCents,
          })),
        },
      },
    });

    // Recria movimentos de estoque sequencialmente
    for (const item of items) {
      await db.stockMovement.create({
        data: {
          productId: item.productId,
          flavorId: item.flavorId,
          type: StockMovementType.SALE,
          quantity: -item.quantity,
          saleId: id,
        },
      });
    }

    revalidatePath("/sales");
    return { ok: true };
  } catch (e) {
    console.error("updateSale error:", e);
    return { ok: false, error: "Erro ao atualizar venda." };
  }
}

// ─── Marcar como pago ────────────────────────────────────────────────────────

export async function markAsPaid(id: string): Promise<ActionResult> {
  await requireSession();
  await db.sale.update({
    where: { id },
    data: { status: "PAID", paidAt: new Date(), paymentForecastDate: null, forecastPreset: null },
  });
  revalidatePath("/sales");
  return { ok: true };
}

// ─── Excluir venda ───────────────────────────────────────────────────────────

export async function deleteSale(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await db.stockMovement.deleteMany({ where: { saleId: id } });
    await db.sale.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
  revalidatePath("/sales");
  return { ok: true };
}
