import { PrismaClient } from "@prisma/client";
import { DIRECT_DATABASE_URL } from "./direct-database-url";
import { computeRecipeConsumption } from "@/server/actions/production";

const db = new PrismaClient({
  datasources: { db: { url: DIRECT_DATABASE_URL } },
});

type Summary = {
  purchaseInserted: number;
  purchaseSkipped: number;
  productionInserted: number;
  productionSkipped: number;
  consumptionInserted: number;
  consumptionSkipped: number;
};

async function main() {
  const duplicateLineKeys: string[] = [];
  const summary: Summary = {
    purchaseInserted: 0,
    purchaseSkipped: 0,
    productionInserted: 0,
    productionSkipped: 0,
    consumptionInserted: 0,
    consumptionSkipped: 0,
  };

  await db.$transaction(
    async (tx) => {
      const purchaseItems = await tx.purchaseItem.findMany({
        select: { purchaseId: true, itemId: true, quantity: true, workspaceId: true },
      });

      const seen = new Map<string, number>();
      for (const line of purchaseItems) {
        const key = `${line.purchaseId}|${line.itemId}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      for (const [key, count] of seen) {
        if (count > 1) duplicateLineKeys.push(`${key} (${count} linhas)`);
      }

      for (const line of purchaseItems) {
        const existing = await tx.stockMovement.findFirst({
          where: { type: "PURCHASE", purchaseId: line.purchaseId, itemId: line.itemId },
          select: { id: true },
        });
        if (existing) {
          summary.purchaseSkipped++;
          continue;
        }
        await tx.stockMovement.create({
          data: {
            type: "PURCHASE",
            quantity: Math.round(line.quantity),
            itemId: line.itemId,
            variantId: null,
            purchaseId: line.purchaseId,
            workspaceId: line.workspaceId,
          },
        });
        summary.purchaseInserted++;
      }

      const batches = await tx.productionBatch.findMany({
        include: { variantLines: { select: { variantId: true, quantity: true } } },
      });

      for (const batch of batches) {
        const activeLines = batch.variantLines.filter((l) => l.variantId && l.quantity > 0);
        const legacyVariantLine =
          activeLines.length === 0 && batch.variantId
            ? [{ variantId: batch.variantId, quantity: batch.quantity }]
            : [];
        const effectiveLines = activeLines.length > 0 ? activeLines : legacyVariantLine;

        const hasProduction = await tx.stockMovement.findFirst({
          where: { type: "PRODUCTION", productionBatchId: batch.id },
          select: { id: true },
        });
        if (hasProduction) {
          summary.productionSkipped++;
        } else if (effectiveLines.length > 0) {
          for (const line of effectiveLines) {
            await tx.stockMovement.create({
              data: {
                type: "PRODUCTION",
                quantity: line.quantity,
                itemId: batch.itemId,
                variantId: line.variantId,
                productionBatchId: batch.id,
                workspaceId: batch.workspaceId,
              },
            });
            summary.productionInserted++;
          }
        } else {
          await tx.stockMovement.create({
            data: {
              type: "PRODUCTION",
              quantity: batch.quantity,
              itemId: batch.itemId,
              variantId: null,
              productionBatchId: batch.id,
              workspaceId: batch.workspaceId,
            },
          });
          summary.productionInserted++;
        }

        if (!batch.recipeId) continue;

        const hasConsumption = await tx.stockMovement.findFirst({
          where: { type: "CONSUMPTION", productionBatchId: batch.id },
          select: { id: true },
        });
        if (hasConsumption) {
          summary.consumptionSkipped++;
          continue;
        }

        const consumption = await computeRecipeConsumption(
          tx,
          batch.recipeId,
          batch.quantity,
          effectiveLines,
        );
        for (const [itemId, consumedQty] of consumption) {
          if (consumedQty <= 0) continue;
          await tx.stockMovement.create({
            data: {
              type: "CONSUMPTION",
              quantity: -Math.round(consumedQty),
              itemId,
              productionBatchId: batch.id,
              workspaceId: batch.workspaceId,
            },
          });
          summary.consumptionInserted++;
        }
      }
    },
    { timeout: 300000, maxWait: 30000 },
  );

  console.log("PURCHASE   inseridos:", summary.purchaseInserted, "| pulados:", summary.purchaseSkipped);
  console.log("PRODUCTION inseridos:", summary.productionInserted, "| lotes pulados:", summary.productionSkipped);
  console.log("CONSUMPTION inseridos:", summary.consumptionInserted, "| lotes pulados:", summary.consumptionSkipped);

  if (duplicateLineKeys.length > 0) {
    console.warn(
      "\nATENÇÃO: a idempotência do PURCHASE usa a chave (purchaseId, itemId), então uma compra",
      "com mais de uma linha do MESMO item recebe apenas UM movimento no backfill.",
      "Confira e ajuste manualmente estes casos:",
    );
    for (const key of duplicateLineKeys) console.warn(`  ${key}`);
  }

  const totals = await db.stockMovement.groupBy({ by: ["type"], _count: { _all: true }, _sum: { quantity: true } });
  console.log("\nTotal de stock_movement por tipo:");
  for (const row of totals.sort((a, b) => a.type.localeCompare(b.type))) {
    console.log(`  ${row.type}: ${row._count._all} linhas, soma ${row._sum.quantity ?? 0}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
