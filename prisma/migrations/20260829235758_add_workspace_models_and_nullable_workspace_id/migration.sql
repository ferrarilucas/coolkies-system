-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELED', 'EXPIRED');

-- DropIndex
DROP INDEX IF EXISTS "stock_movement_productionBatchId_key";

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "flavor" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "ingredient" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "ingredient_purchase" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "market" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "price_history" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "price_list_item" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "production_batch" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "production_filling" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "recipe" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "recipe_ingredient" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "sale_item" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "session" ADD COLUMN     "activeWorkspaceId" TEXT;

-- AlterTable
ALTER TABLE "shopping_list_item" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "stock_movement" ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inviterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_slug_key" ON "workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "member_workspaceId_userId_key" ON "member"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_tokenHash_key" ON "invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "invitation_workspaceId_status_idx" ON "invitation"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
