-- AlterTable
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_publicToken_key" ON "workspace"("publicToken");
