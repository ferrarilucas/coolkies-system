"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeBlocked, getScopedDb } from "@/server/tenant/context";
import { StockMovementType } from "@prisma/client";
import { parsePaymentChoice, planPayment, type PaymentFields } from "@/lib/installments";
import { syncSaleSummary, toPlans, writeInstallments } from "@/server/sales/installments";
import { allocate, allocationMatches, type ExpectedPartial, type ExpectedRow, type RemainderChoice } from "@/lib/partial-payment";
import {
  applyPartial,
  isConcurrencyError,
  lockSales,
  RACE_ERROR,
  revertSplits,
  RevertAbort,
} from "@/server/sales/partial-payment";

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
  const blocked = await writeBlocked();
  if (blocked) return blocked;

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
  const blocked = await writeBlocked();
  if (blocked) return blocked;

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

  try {
    const plan = await db.$transaction(async (tx) => {
      await lockSales(tx, workspaceId, [id]);
      const existing = await tx.saleInstallment.findMany({ where: { saleId: id }, orderBy: { number: "asc" } });
      const planned = planPayment(choice, totalCents, toPlans(existing), new Date());
      if (!planned.ok) return planned;
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
      await writeInstallments(tx, id, workspaceId, planned.installments);
      return planned;
    });
    if (!plan.ok) return { ok: false, error: plan.error };

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

class PayAbort extends Error {}

const PAY_NONE_OPEN = "Nenhuma parcela em aberto selecionada.";

export async function payInstallments(
  installmentIds: string[],
): Promise<ActionResult<{ count: number; totalCents: number }>> {
  if (installmentIds.length === 0) return { ok: false, error: "Selecione ao menos uma parcela." };

  const { db, workspaceId } = await getScopedDb();
  const blocked = await writeBlocked();
  if (blocked) return blocked;

  const candidates = await db.saleInstallment.findMany({
    where: { id: { in: installmentIds }, paidAt: null },
    select: { saleId: true },
  });
  if (candidates.length === 0) return { ok: false, error: PAY_NONE_OPEN };
  const saleIds = [...new Set(candidates.map((i) => i.saleId))];

  try {
    const data = await db.$transaction(
      async (tx) => {
        await lockSales(tx, workspaceId, saleIds);
        const open = await tx.saleInstallment.findMany({
          where: { id: { in: installmentIds }, saleId: { in: saleIds }, paidAt: null },
          select: { id: true, saleId: true, amountCents: true },
        });
        if (open.length === 0) throw new PayAbort(RACE_ERROR);
        await tx.saleInstallment.updateMany({
          where: { id: { in: open.map((i) => i.id) }, paidAt: null },
          data: { paidAt: new Date() },
        });
        await syncSaleSummary(tx, [...new Set(open.map((i) => i.saleId))]);
        return { count: open.length, totalCents: open.reduce((sum, i) => sum + i.amountCents, 0) };
      },
      { timeout: 15000 },
    );
    revalidatePayments();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof PayAbort) return { ok: false, error: e.message };
    if (isConcurrencyError(e)) {
      console.warn("payInstallments concorrência:", e instanceof Error ? e.message : e);
      return { ok: false, error: RACE_ERROR };
    }
    console.error("payInstallments error:", e);
    return { ok: false, error: "Erro ao receber pagamento." };
  }
}

class ReceiveAbort extends Error {}

const MAX_RECEIVE_CENTS = 100_000_000;
const RECEIVE_INVALID = "Dados de recebimento inválidos.";
const RECEIVE_NEEDS_REMAINDER = "Escolha o que fazer com o restante.";
const RECEIVE_ZERO = "Informe um valor maior que zero.";

const remainderSchema = z.discriminatedUnion(
  "mode",
  [
    z.object({
      mode: z.literal("NEW_DATE"),
      dueDate: z.string({ errorMap: () => ({ message: "Informe uma data válida." }) }).max(10, "Informe uma data válida."),
    }),
    z.object({ mode: z.literal("SPREAD") }),
    z.object({ mode: z.literal("APPEND") }),
  ],
  { errorMap: () => ({ message: RECEIVE_NEEDS_REMAINDER }) },
);

const receiveSchema = z.object(
  {
    installmentIds: z
      .array(
        z
          .string({ errorMap: () => ({ message: "Selecione ao menos uma parcela." }) })
          .min(1, "Selecione ao menos uma parcela.")
          .max(64, "Parcela inválida."),
        { errorMap: () => ({ message: "Selecione ao menos uma parcela." }) },
      )
      .min(1, "Selecione ao menos uma parcela.")
      .max(500, "Selecione menos parcelas.")
      .refine((ids) => new Set(ids).size === ids.length, "Parcelas repetidas na seleção."),
    amountCents: z
      .number({ errorMap: () => ({ message: RECEIVE_ZERO }) })
      .int(RECEIVE_ZERO)
      .positive(RECEIVE_ZERO)
      .max(MAX_RECEIVE_CENTS, "O valor é maior que o total selecionado."),
    remainder: remainderSchema.optional(),
    expected: z
      .object({
        partialId: z.string().min(1).max(64),
        paidCents: z.number().int().positive().max(MAX_RECEIVE_CENTS),
        remainderCents: z.number().int().positive().max(MAX_RECEIVE_CENTS),
      })
      .strict()
      .nullable()
      .optional(),
    expectedRows: z
      .array(z.object({ id: z.string().min(1).max(64), amountCents: z.number().int().nonnegative() }).strict())
      .max(500)
      .optional(),
  },
  { errorMap: () => ({ message: RECEIVE_INVALID }) },
);

export async function receivePayment(input: {
  installmentIds: string[];
  amountCents: number;
  remainder?: RemainderChoice;
  expected?: ExpectedPartial;
  expectedRows?: ExpectedRow[];
}): Promise<ActionResult<{ count: number; totalCents: number; partial: boolean; paidInstallmentIds: string[] }>> {
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? RECEIVE_INVALID };
  const { installmentIds, amountCents, remainder, expected, expectedRows } = parsed.data;

  const { db, workspaceId } = await getScopedDb();
  const blocked = await writeBlocked();
  if (blocked) return blocked;

  const open = await db.saleInstallment.findMany({
    where: { id: { in: installmentIds }, paidAt: null },
    select: { id: true, saleId: true, number: true, amountCents: true, dueDate: true, sale: { select: { soldAt: true } } },
  });
  const openCents = open.reduce((sum, i) => sum + i.amountCents, 0);
  if (openCents < amountCents && open.length < installmentIds.length) return { ok: false, error: RACE_ERROR };

  const allocated = allocate(
    open.map((i) => ({ id: i.id, number: i.number, amountCents: i.amountCents, dueDate: i.dueDate, soldAt: i.sale.soldAt })),
    amountCents,
  );
  if (!allocated.ok) return { ok: false, error: allocated.error };
  const { fullIds, partial } = allocated.allocation;

  const choice = partial ? remainder : undefined;
  if (partial && !choice) return { ok: false, error: RECEIVE_NEEDS_REMAINDER };

  const byId = new Map(open.map((i) => [i.id, i]));
  const paidInstallmentIds = partial ? [...fullIds, partial.id] : fullIds;
  const touchedSaleIds = [...new Set(paidInstallmentIds.map((id) => byId.get(id)!.saleId))];
  const fullByAmount = new Map<number, string[]>();
  for (const id of fullIds) {
    const amount = byId.get(id)!.amountCents;
    fullByAmount.set(amount, [...(fullByAmount.get(amount) ?? []), id]);
  }
  const paidAt = new Date();

  try {
    await db.$transaction(
      async (tx) => {
        const locked = await lockSales(tx, workspaceId, touchedSaleIds);
        if (locked !== touchedSaleIds.length) throw new ReceiveAbort(RACE_ERROR);
        if (expected !== undefined) {
          const fresh = await tx.saleInstallment.findMany({
            where: { id: { in: installmentIds }, paidAt: null },
            select: { id: true, number: true, amountCents: true, dueDate: true, sale: { select: { soldAt: true } } },
          });
          const realloc = allocate(
            fresh.map((i) => ({ id: i.id, number: i.number, amountCents: i.amountCents, dueDate: i.dueDate, soldAt: i.sale.soldAt })),
            amountCents,
          );
          if (
            fresh.length !== installmentIds.length ||
            !realloc.ok ||
            !allocationMatches(realloc.allocation, expected) ||
            !allocationMatches(allocated.allocation, expected) ||
            [...realloc.allocation.fullIds].sort().join() !== [...fullIds].sort().join()
          ) {
            throw new ReceiveAbort(RACE_ERROR);
          }
        }
        for (const [amount, ids] of fullByAmount) {
          const updated = await tx.saleInstallment.updateMany({
            where: { id: { in: ids }, paidAt: null, amountCents: amount },
            data: { paidAt },
          });
          if (updated.count !== ids.length) throw new ReceiveAbort(RACE_ERROR);
        }
        if (partial && choice) {
          const saleId = byId.get(partial.id)!.saleId;
          const applied = await applyPartial(tx, {
            saleId,
            workspaceId,
            partialId: partial.id,
            paidCents: partial.paidCents,
            remainderCents: partial.remainderCents,
            choice,
            paidAt,
            excludeIds: fullIds.filter((id) => byId.get(id)!.saleId === saleId),
            expectedRows,
          });
          if (!applied.ok) throw new ReceiveAbort(applied.error);
        }
        await syncSaleSummary(tx, touchedSaleIds);
      },
      { timeout: 15000 },
    );
  } catch (e) {
    if (e instanceof ReceiveAbort) return { ok: false, error: e.message };
    if (isConcurrencyError(e)) {
      console.warn("receivePayment concorrência:", e instanceof Error ? e.message : e);
      return { ok: false, error: RACE_ERROR };
    }
    console.error("receivePayment error:", e);
    return { ok: false, error: "Erro ao receber pagamento." };
  }

  revalidatePayments();
  return {
    ok: true,
    data: { count: paidInstallmentIds.length, totalCents: amountCents, partial: partial !== null, paidInstallmentIds },
  };
}

class UnpayAbort extends Error {}

const UNPAY_FAILED = "Não foi possível desfazer.";
const UNPAY_RACE = "Esta venda mudou enquanto você desfazia. Tente de novo.";
const UNPAY_ERROR = "Erro ao desfazer.";

type Unpaid = {
  rows: { id: string; saleId: string; amountCents: number }[];
  after: { id: string; number: number; sale: { installmentCount: number } }[];
  restored: string[];
  reopenedOnly: string[];
};

async function unpayLocked(
  db: Awaited<ReturnType<typeof getScopedDb>>["db"],
  workspaceId: string,
  installmentIds: string[],
  seenPaid = false,
): Promise<ActionResult<Unpaid>> {
  const candidates = await db.saleInstallment.findMany({
    where: { id: { in: installmentIds }, paidAt: { not: null } },
    select: { saleId: true },
  });
  if (candidates.length === 0) return { ok: false, error: seenPaid ? UNPAY_RACE : UNPAY_FAILED };
  const saleIds = [...new Set(candidates.map((i) => i.saleId))];

  try {
    const data = await db.$transaction(
      async (tx) => {
        await lockSales(tx, workspaceId, saleIds);
        const rows = await tx.saleInstallment.findMany({
          where: { id: { in: installmentIds }, saleId: { in: saleIds }, paidAt: { not: null } },
          select: { id: true, saleId: true, amountCents: true },
        });
        if (rows.length === 0) throw new UnpayAbort(UNPAY_RACE);
        const ids = rows.map((i) => i.id);
        const reverted = await revertSplits(tx, ids);
        await tx.saleInstallment.updateMany({ where: { id: { in: ids } }, data: { paidAt: null } });
        await syncSaleSummary(tx, [...new Set(rows.map((i) => i.saleId))]);
        const after = await tx.saleInstallment.findMany({
          where: { id: { in: ids } },
          select: { id: true, number: true, sale: { select: { installmentCount: true } } },
        });
        return { rows, after, ...reverted };
      },
      { timeout: 15000 },
    );
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UnpayAbort) return { ok: false, error: e.message };
    if (e instanceof RevertAbort || isConcurrencyError(e)) {
      console.warn("unpayInstallments concorrência:", e instanceof Error ? e.message : e);
      return { ok: false, error: UNPAY_RACE };
    }
    console.error("unpayInstallments error:", e);
    return { ok: false, error: UNPAY_ERROR };
  }
}

export async function unpayInstallments(installmentIds: string[]): Promise<ActionResult> {
  if (installmentIds.length === 0) return { ok: false, error: "Selecione ao menos uma parcela." };

  const { db, workspaceId } = await getScopedDb();
  const blocked = await writeBlocked();
  if (blocked) return blocked;

  const res = await unpayLocked(db, workspaceId, installmentIds);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePayments();
  return { ok: true };
}

export async function unpayLastInstallment(
  saleId: string,
): Promise<ActionResult<{ installmentId: string; number: number; installmentCount: number; hadPartial: boolean }>> {
  const { db, workspaceId } = await getScopedDb();
  const blocked = await writeBlocked();
  if (blocked) return blocked;

  const last = await db.saleInstallment.findFirst({
    where: { saleId, paidAt: { not: null } },
    orderBy: [{ paidAt: "desc" }, { number: "desc" }],
    select: { id: true },
  });
  if (!last) return { ok: false, error: "Esta venda não tem parcela paga." };

  const res = await unpayLocked(db, workspaceId, [last.id], true);
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  revalidatePayments();
  const { after, restored, reopenedOnly } = res.data;
  const reopened = after.find((i) => i.id === last.id);
  if (!reopened) return { ok: false, error: UNPAY_RACE };
  return {
    ok: true,
    data: {
      installmentId: last.id,
      number: reopened.number,
      installmentCount: reopened.sale.installmentCount,
      hadPartial: restored.length + reopenedOnly.length > 0,
    },
  };
}

export async function unpayLastCollection(
  customerId: string,
): Promise<ActionResult<{ installmentIds: string[]; count: number; totalCents: number; hadPartial: boolean }>> {
  const { db, workspaceId } = await getScopedDb();
  const blocked = await writeBlocked();
  if (blocked) return blocked;

  const latest = await db.saleInstallment.findFirst({
    where: { sale: { customerId }, paidAt: { not: null } },
    orderBy: { paidAt: "desc" },
    select: { paidAt: true },
  });
  if (!latest?.paidAt) return { ok: false, error: "Nenhum recebimento para desfazer." };

  const batch = await db.saleInstallment.findMany({
    where: { sale: { customerId }, paidAt: latest.paidAt },
    select: { id: true },
  });

  const res = await unpayLocked(
    db,
    workspaceId,
    batch.map((i) => i.id),
    true,
  );
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  revalidatePayments();
  const { rows, restored, reopenedOnly } = res.data;
  return {
    ok: true,
    data: {
      installmentIds: rows.map((i) => i.id),
      count: rows.length,
      totalCents: rows.reduce((sum, i) => sum + i.amountCents, 0),
      hadPartial: restored.length + reopenedOnly.length > 0,
    },
  };
}

// ─── Excluir venda ───────────────────────────────────────────────────────────

export async function deleteSale(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  const blocked = await writeBlocked();
  if (blocked) return blocked;
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
