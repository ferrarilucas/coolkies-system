-- Escrita a mao (sem prisma migrate dev): historico de migrations do banco de
-- dev esta divergente do schema versionado, e migrate dev propunha um reset.

-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('INTERPIX', 'MANUAL');

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PENDING_AUTH';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'AUTH_DENIED';

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN "provider" "SubscriptionProvider" NOT NULL DEFAULT 'INTERPIX';
ALTER TABLE "subscription" ADD COLUMN "interpixSubscriptionId" TEXT;
ALTER TABLE "subscription" ADD COLUMN "interpixPixCopyPaste" TEXT;
ALTER TABLE "subscription" ADD COLUMN "lastAppliedEventId" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "subscription_interpixSubscriptionId_key" ON "subscription"("interpixSubscriptionId");

-- Backfill: nao ha assinante real ainda, entao qualquer linha ASAAS e residuo
-- de teste. Fica MANUAL (alguem tem acesso liberado, nenhum gateway administra).
UPDATE "subscription"
SET "provider" = 'MANUAL',
    "notes" = COALESCE("notes" || ' ', '') || 'Migracao InterPix: linha ASAAS sem assinante real, marcada MANUAL.'
WHERE "source" = 'ASAAS';

UPDATE "subscription" SET "provider" = 'MANUAL' WHERE "source" = 'MANUAL';

-- Traducao dos ids de plano do catalogo (Task 1 renomeou solo/team/unlimited
-- para corre/cresce/escala; a migration historica de backfill de agosto
-- continua gravando os ids antigos de proposito).
UPDATE "subscription" SET "plan" = 'corre' WHERE "plan" = 'solo';
UPDATE "subscription" SET "plan" = 'cresce' WHERE "plan" = 'team';
UPDATE "subscription" SET "plan" = 'escala' WHERE "plan" = 'unlimited';
