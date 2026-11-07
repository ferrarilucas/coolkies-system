import { Prisma } from "@prisma/client";
import { z } from "zod";
import { openRowsMatch, planPreset, planRemainder, RACE_ERROR, type ExpectedRow, type RemainderChoice } from "@/lib/partial-payment";

export { RACE_ERROR };

type SplitShare = { installmentId: string; cents: number; created: boolean };

const sharesSchema = z.array(
  z.object({ installmentId: z.string().min(1), cents: z.number().int().nonnegative(), created: z.boolean() }).strict(),
);

const RACE_PRISMA_CODES = new Set(["P2034"]);
const RACE_PG_CODES = ["40P01"];

function mentionsRacePgCode(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return RACE_PG_CODES.some((code) => text.includes(code)) || text.includes("deadlock detected");
}

export function isConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RACE_PRISMA_CODES.has(error.code) || mentionsRacePgCode(error.meta) || mentionsRacePgCode(error.message);
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) return mentionsRacePgCode(error.message);
  return false;
}

export async function lockSales(tx: Prisma.TransactionClient, workspaceId: string, saleIds: string[]): Promise<number> {
  const ids = [...new Set(saleIds)].sort();
  if (ids.length === 0) return 0;
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "sale"
    WHERE "workspaceId" = ${workspaceId} AND "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `;
  return locked.length;
}

export async function resequence(tx: Prisma.TransactionClient, saleId: string, orderedIds: string[]): Promise<void> {
  for (const [idx, id] of orderedIds.entries()) {
    await tx.saleInstallment.update({ where: { id, saleId }, data: { number: -(idx + 1) } });
  }
  for (const [idx, id] of orderedIds.entries()) {
    await tx.saleInstallment.update({ where: { id, saleId }, data: { number: idx + 1 } });
  }
}

export async function applyPartial(
  tx: Prisma.TransactionClient,
  input: {
    saleId: string;
    workspaceId: string;
    partialId: string;
    paidCents: number;
    remainderCents: number;
    choice: RemainderChoice;
    paidAt: Date;
    excludeIds: string[];
    expectedRows?: ExpectedRow[];
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const originalCents = input.paidCents + input.remainderCents;
  const sale = await tx.sale.findUnique({ where: { id: input.saleId }, select: { forecastPreset: true } });
  const rows = await tx.saleInstallment.findMany({
    where: { saleId: input.saleId },
    orderBy: { number: "asc" },
    select: { id: true, number: true, amountCents: true, dueDate: true, forecastPreset: true, paidAt: true },
  });
  const partial = rows.find((row) => row.id === input.partialId);
  if (!sale || !partial || partial.paidAt !== null || partial.amountCents !== originalCents) {
    return { ok: false, error: RACE_ERROR };
  }
  if (
    input.choice.mode === "SPREAD" &&
    input.expectedRows &&
    !openRowsMatch(rows, input.expectedRows, [partial.id, ...input.excludeIds])
  ) {
    return { ok: false, error: RACE_ERROR };
  }

  const planned = planRemainder(
    rows,
    partial.number,
    input.remainderCents,
    input.choice,
    planPreset(rows, sale.forecastPreset),
    input.paidAt,
    input.excludeIds,
  );
  if (!planned.ok) return planned;

  const paid = await tx.saleInstallment.updateMany({
    where: { id: partial.id, saleId: input.saleId, paidAt: null, amountCents: originalCents },
    data: { amountCents: input.paidCents, paidAt: input.paidAt },
  });
  if (paid.count !== 1) return { ok: false, error: RACE_ERROR };

  const shares: SplitShare[] = [];
  const amountById = new Map(rows.map((row) => [row.id, row.amountCents]));
  for (const update of planned.plan.updates) {
    const moved = await tx.saleInstallment.updateMany({
      where: { id: update.id, saleId: input.saleId, paidAt: null, amountCents: amountById.get(update.id) },
      data: { amountCents: update.amountCents },
    });
    if (moved.count !== 1) return { ok: false, error: RACE_ERROR };
    shares.push({ installmentId: update.id, cents: update.amountCents - (amountById.get(update.id) ?? 0), created: false });
  }

  if (planned.plan.creates.length > 0) {
    const order = rows.map((row) => ({ id: row.id, number: row.number }));
    let nextTemp = rows.reduce((max, row) => Math.max(max, row.number), 0) + 1;
    for (const create of planned.plan.creates) {
      const created = await tx.saleInstallment.create({
        data: {
          saleId: input.saleId,
          workspaceId: input.workspaceId,
          number: nextTemp,
          amountCents: create.amountCents,
          dueDate: create.dueDate,
          forecastPreset: create.forecastPreset,
          paidAt: null,
        },
        select: { id: true },
      });
      nextTemp += 1;
      const anchor = order.findLastIndex((entry) => entry.number <= create.placeAfterNumber);
      order.splice(anchor + 1, 0, { id: created.id, number: create.placeAfterNumber });
      shares.push({ installmentId: created.id, cents: create.amountCents, created: true });
    }
    await resequence(
      tx,
      input.saleId,
      order.map((entry) => entry.id),
    );
  }

  const stale = await tx.installmentSplit.deleteMany({ where: { paidInstallmentId: partial.id } });
  if (stale.count > 0) {
    console.warn("applyPartial removeu split antigo", { saleId: input.saleId, installmentId: partial.id });
  }
  await tx.installmentSplit.create({
    data: {
      saleId: input.saleId,
      paidInstallmentId: partial.id,
      originalCents,
      mode: input.choice.mode,
      shares,
      workspaceId: input.workspaceId,
    },
  });

  return { ok: true };
}

export class RevertAbort extends Error {}

type SplitRow = { id: string; saleId: string; paidInstallmentId: string; originalCents: number; shares: Prisma.JsonValue };

async function revertSplit(tx: Prisma.TransactionClient, split: SplitRow): Promise<boolean> {
  const parsed = sharesSchema.safeParse(split.shares);
  if (!parsed.success) {
    console.warn("revertSplits shares inválido", { splitId: split.id });
    return false;
  }
  const shares = parsed.data;
  const rows = await tx.saleInstallment.findMany({
    where: { saleId: split.saleId },
    orderBy: { number: "asc" },
    select: { id: true, amountCents: true, paidAt: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paid = byId.get(split.paidInstallmentId);
  const shareIds = new Set(shares.map((share) => share.installmentId));
  const movedCents = shares.reduce((sum, share) => sum + share.cents, 0);
  const clean =
    paid !== undefined &&
    paid.paidAt !== null &&
    paid.amountCents + movedCents === split.originalCents &&
    shareIds.size === shares.length &&
    !shareIds.has(split.paidInstallmentId) &&
    shares.every((share) => {
      const row = byId.get(share.installmentId);
      if (!row || row.paidAt !== null) return false;
      return share.created ? row.amountCents === share.cents : row.amountCents >= share.cents;
    });
  if (!clean) return false;

  const restoredPaid = await tx.saleInstallment.updateMany({
    where: { id: paid.id, saleId: split.saleId, amountCents: paid.amountCents, paidAt: { not: null } },
    data: { amountCents: split.originalCents, paidAt: null },
  });
  if (restoredPaid.count !== 1) return false;

  const createdIds = shares.filter((share) => share.created).map((share) => share.installmentId);
  for (const share of shares) {
    const row = byId.get(share.installmentId)!;
    if (share.created) {
      const removed = await tx.saleInstallment.deleteMany({
        where: { id: row.id, saleId: split.saleId, paidAt: null, amountCents: share.cents },
      });
      if (removed.count !== 1) throw new RevertAbort();
    } else if (share.cents > 0) {
      const reduced = await tx.saleInstallment.updateMany({
        where: { id: row.id, saleId: split.saleId, paidAt: null, amountCents: row.amountCents },
        data: { amountCents: row.amountCents - share.cents },
      });
      if (reduced.count !== 1) throw new RevertAbort();
    }
  }
  if (createdIds.length > 0) {
    const removedIds = new Set(createdIds);
    await resequence(
      tx,
      split.saleId,
      rows.filter((row) => !removedIds.has(row.id)).map((row) => row.id),
    );
  }
  return true;
}

export async function revertSplits(
  tx: Prisma.TransactionClient,
  paidInstallmentIds: string[],
): Promise<{ restored: string[]; reopenedOnly: string[] }> {
  const restored: string[] = [];
  const reopenedOnly: string[] = [];
  if (paidInstallmentIds.length === 0) return { restored, reopenedOnly };
  const splits = await tx.installmentSplit.findMany({
    where: { paidInstallmentId: { in: [...new Set(paidInstallmentIds)] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, saleId: true, paidInstallmentId: true, originalCents: true, shares: true },
  });
  for (const split of splits) {
    const clean = await revertSplit(tx, split);
    await tx.installmentSplit.deleteMany({ where: { id: split.id } });
    (clean ? restored : reopenedOnly).push(split.paidInstallmentId);
  }
  return { restored, reopenedOnly };
}
