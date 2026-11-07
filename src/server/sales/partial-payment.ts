import { Prisma, type ForecastPreset } from "@prisma/client";
import { planRemainder, type RemainderChoice, type SaleRow } from "@/lib/partial-payment";

export const RACE_ERROR = "Algumas parcelas já foram recebidas. Revise o valor.";

type SplitShare = { installmentId: string; cents: number; created: boolean };

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

export function planPreset(rows: SaleRow[], salePreset: ForecastPreset | null): ForecastPreset | null {
  const fromPlan = [...rows]
    .sort((a, b) => b.number - a.number)
    .find((row) => row.forecastPreset !== null && row.forecastPreset !== "CUSTOM");
  return fromPlan?.forecastPreset ?? salePreset;
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
