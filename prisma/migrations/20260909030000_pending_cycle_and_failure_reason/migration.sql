-- Escrita a mao (sem prisma migrate dev): historico de migrations do banco de
-- dev esta divergente do schema versionado, e migrate dev propunha um reset.

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN "pendingCycleSeq" INTEGER;
ALTER TABLE "subscription" ADD COLUMN "lastFailureReason" TEXT;
