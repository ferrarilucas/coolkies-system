-- AlterEnum
ALTER TYPE "SubscriptionProvider" ADD VALUE IF NOT EXISTS 'STRIPE';

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "stripeSyncedAt" TIMESTAMP(3);
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "cardBrand" TEXT;
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "cardLast4" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_stripeCustomerId_key" ON "subscription"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_stripeSubscriptionId_key" ON "subscription"("stripeSubscriptionId");
