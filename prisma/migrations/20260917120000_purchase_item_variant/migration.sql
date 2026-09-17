BEGIN;

ALTER TABLE "purchase_item" ADD COLUMN "variantId" TEXT;

ALTER TABLE "purchase_item"
  ADD CONSTRAINT "purchase_item_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "variant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "purchase_item_variantId_idx" ON "purchase_item"("variantId");

COMMIT;
