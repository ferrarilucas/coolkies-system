BEGIN;

DO $$ BEGIN
  CREATE TYPE "RemainderMode" AS ENUM ('NEW_DATE', 'SPREAD', 'APPEND');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "installment_split" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "paidInstallmentId" TEXT NOT NULL,
    "originalCents" INTEGER NOT NULL,
    "mode" "RemainderMode" NOT NULL,
    "shares" JSONB NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installment_split_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "installment_split_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "installment_split_paidInstallmentId_fkey" FOREIGN KEY ("paidInstallmentId") REFERENCES "sale_installment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "installment_split_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "installment_split_paidInstallmentId_key" ON "installment_split"("paidInstallmentId");
CREATE INDEX IF NOT EXISTS "installment_split_workspaceId_saleId_idx" ON "installment_split"("workspaceId", "saleId");

COMMIT;
