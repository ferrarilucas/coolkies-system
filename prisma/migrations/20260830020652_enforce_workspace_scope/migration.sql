-- DropIndex
DROP INDEX "customer_email_key";

-- DropIndex
DROP INDEX "ingredient_name_key";

-- DropIndex
DROP INDEX "ingredient_purchase_ingredientId_purchasedAt_idx";

-- DropIndex
DROP INDEX "market_name_key";

-- DropIndex
DROP INDEX "product_name_key";

-- DropIndex
DROP INDEX "recipe_name_key";

-- DropIndex
DROP INDEX "sale_soldAt_idx";

-- DropIndex
DROP INDEX "sale_status_paymentForecastDate_idx";

-- DropIndex
DROP INDEX "stock_movement_productId_flavorId_idx";

-- AlterTable
ALTER TABLE "customer" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "flavor" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ingredient" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ingredient_purchase" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "market" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "price_history" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "price_list_item" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "product" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "production_batch" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "production_filling" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "recipe" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "recipe_ingredient" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "sale" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "sale_item" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "shopping_list_item" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "stock_movement" ALTER COLUMN "workspaceId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "customer_workspaceId_email_key" ON "customer"("workspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_workspaceId_name_key" ON "ingredient"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ingredient_purchase_workspaceId_ingredientId_purchasedAt_idx" ON "ingredient_purchase"("workspaceId", "ingredientId", "purchasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "market_workspaceId_name_key" ON "market"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_workspaceId_name_key" ON "product"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_workspaceId_name_key" ON "recipe"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "sale_workspaceId_status_paymentForecastDate_idx" ON "sale"("workspaceId", "status", "paymentForecastDate");

-- CreateIndex
CREATE INDEX "sale_workspaceId_soldAt_idx" ON "sale"("workspaceId", "soldAt");

-- CreateIndex
CREATE INDEX "stock_movement_workspaceId_productId_flavorId_idx" ON "stock_movement"("workspaceId", "productId", "flavorId");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flavor" ADD CONSTRAINT "flavor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market" ADD CONSTRAINT "market_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_purchase" ADD CONSTRAINT "ingredient_purchase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_filling" ADD CONSTRAINT "production_filling_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

