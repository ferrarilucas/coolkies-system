-- CreateEnum
CREATE TYPE "SubscriptionCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN "cycle" "SubscriptionCycle" NOT NULL DEFAULT 'MONTHLY';
