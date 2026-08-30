-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- DropIndex
DROP INDEX "invitation_tokenHash_key";

-- AlterTable
ALTER TABLE "invitation" DROP COLUMN "tokenHash",
ADD COLUMN     "code" TEXT NOT NULL,
ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "workspace" ADD COLUMN     "graceUntil" TIMESTAMP(3),
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'pro',
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "invitation_code_key" ON "invitation"("code");

