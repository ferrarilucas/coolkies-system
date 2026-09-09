-- Escrita a mao (sem prisma migrate dev): historico de migrations do banco de
-- dev esta divergente do schema versionado, e migrate dev propunha um reset.

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN "graceGrantedAt" TIMESTAMP(3);

-- Backfill: quem ja tem carencia gravada comprovadamente ja recebeu a concessao.
UPDATE "subscription" SET "graceGrantedAt" = "graceUntil" WHERE "graceUntil" IS NOT NULL;
