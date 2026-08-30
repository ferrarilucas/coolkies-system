-- CreateIndex
CREATE INDEX "flavor_workspaceId_idx" ON "flavor"("workspaceId");

-- CreateIndex
CREATE INDEX "price_history_workspaceId_idx" ON "price_history"("workspaceId");

-- CreateIndex
CREATE INDEX "price_list_item_workspaceId_idx" ON "price_list_item"("workspaceId");

-- CreateIndex
CREATE INDEX "production_batch_workspaceId_idx" ON "production_batch"("workspaceId");

-- CreateIndex
CREATE INDEX "production_filling_workspaceId_idx" ON "production_filling"("workspaceId");

-- CreateIndex
CREATE INDEX "recipe_ingredient_workspaceId_idx" ON "recipe_ingredient"("workspaceId");

-- CreateIndex
CREATE INDEX "sale_item_workspaceId_idx" ON "sale_item"("workspaceId");

-- CreateIndex
CREATE INDEX "shopping_list_item_workspaceId_idx" ON "shopping_list_item"("workspaceId");

