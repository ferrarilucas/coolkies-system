-- Remove unique constraint so multiple movements can reference the same production batch
ALTER TABLE "stock_movement" DROP CONSTRAINT IF EXISTS "stock_movement_productionBatchId_key";

-- Remove orphaned production/adjustment movements that have no batch or sale link
-- (created by buggy intermediate code that forgot to set productionBatchId)
DELETE FROM "stock_movement"
WHERE "productionBatchId" IS NULL
  AND "saleId" IS NULL
  AND type IN ('PRODUCTION', 'ADJUSTMENT');
