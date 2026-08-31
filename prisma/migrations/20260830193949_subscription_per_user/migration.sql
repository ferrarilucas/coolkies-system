-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('ASAAS', 'MANUAL');

-- AlterTable
ALTER TABLE "workspace" DROP COLUMN "graceUntil",
DROP COLUMN "plan",
DROP COLUMN "subscriptionStatus",
DROP COLUMN "trialEndsAt";

-- CreateTable
CREATE TABLE "subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'solo',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "source" "SubscriptionSource" NOT NULL DEFAULT 'ASAAS',
    "asaasCustomerId" TEXT,
    "asaasSubscriptionId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_userId_key" ON "subscription"("userId");

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

