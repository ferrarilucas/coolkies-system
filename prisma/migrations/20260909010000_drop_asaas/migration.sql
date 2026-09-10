-- Escrita a mao (sem prisma migrate dev): historico de migrations do banco de
-- dev esta divergente do schema versionado, e migrate dev propunha um reset.

-- Migration destrutiva: remove o gateway Asaas por completo. Seguro porque a
-- migration 20260906120000_interpix_provider ja transferiu toda linha ASAAS
-- para o provedor InterPix ou MANUAL, deixando nota explicando a origem, e
-- nenhum codigo em produção le mais as colunas abaixo (Task 11).

-- AlterTable
ALTER TABLE "subscription" DROP COLUMN "source";
ALTER TABLE "subscription" DROP COLUMN "asaasCustomerId";
ALTER TABLE "subscription" DROP COLUMN "asaasSubscriptionId";

-- DropEnum
DROP TYPE "SubscriptionSource";
