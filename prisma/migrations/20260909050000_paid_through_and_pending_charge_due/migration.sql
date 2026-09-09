-- Escrita a mao (sem prisma migrate dev): historico de migrations do banco de
-- dev esta divergente do schema versionado, e migrate dev propunha um reset.

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN "paidThroughAt" TIMESTAMP(3);
ALTER TABLE "subscription" ADD COLUMN "pendingChargeDueAt" TIMESTAMP(3);
