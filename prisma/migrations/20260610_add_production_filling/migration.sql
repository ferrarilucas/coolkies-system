-- AlterTable: add recipeId and notes to production_batch
ALTER TABLE "production_batch" ADD COLUMN "recipeId" TEXT;
ALTER TABLE "production_batch" ADD COLUMN "notes" TEXT;

-- AlterTable: add fillingRecipeId to flavor
ALTER TABLE "flavor" ADD COLUMN "fillingRecipeId" TEXT;

-- CreateTable: production_filling
CREATE TABLE "production_filling" (
    "id" TEXT NOT NULL,
    "productionBatchId" TEXT NOT NULL,
    "flavorId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "production_filling_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: production_batch.recipeId → recipe.id
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_recipeId_fkey"
    FOREIGN KEY ("recipeId") REFERENCES "recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: flavor.fillingRecipeId → recipe.id
ALTER TABLE "flavor" ADD CONSTRAINT "flavor_fillingRecipeId_fkey"
    FOREIGN KEY ("fillingRecipeId") REFERENCES "recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: production_filling.productionBatchId → production_batch.id
ALTER TABLE "production_filling" ADD CONSTRAINT "production_filling_productionBatchId_fkey"
    FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: production_filling.flavorId → flavor.id
ALTER TABLE "production_filling" ADD CONSTRAINT "production_filling_flavorId_fkey"
    FOREIGN KEY ("flavorId") REFERENCES "flavor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
