BEGIN;

ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "installmentCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "openCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "sale_installment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "forecastPreset" "ForecastPreset",
    "paidAt" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sale_installment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_installment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sale_installment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "sale_installment_saleId_number_key" ON "sale_installment"("saleId", "number");
CREATE INDEX IF NOT EXISTS "sale_installment_workspaceId_paidAt_dueDate_idx" ON "sale_installment"("workspaceId", "paidAt", "dueDate");

INSERT INTO "sale_installment" ("id", "saleId", "number", "amountCents", "dueDate", "forecastPreset", "paidAt", "workspaceId", "updatedAt")
SELECT
    'inst_' || s."id",
    s."id",
    1,
    s."totalCents",
    s."paymentForecastDate",
    s."forecastPreset",
    CASE WHEN s."status" = 'PAID' THEN COALESCE(s."paidAt", s."soldAt") END,
    s."workspaceId",
    CURRENT_TIMESTAMP
FROM "sale" s
WHERE NOT EXISTS (SELECT 1 FROM "sale_installment" i WHERE i."saleId" = s."id");

UPDATE "sale"
SET "openCents" = CASE WHEN "status" = 'PENDING' THEN "totalCents" ELSE 0 END
WHERE "installmentCount" = 1;

COMMIT;
