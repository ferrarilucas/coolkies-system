-- Insumo genérico: matéria-prima e/ou revenda
ALTER TABLE "ingredient" ADD COLUMN IF NOT EXISTS "isRawMaterial" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ingredient" ADD COLUMN IF NOT EXISTS "forResale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ingredient" ADD COLUMN IF NOT EXISTS "resaleProductId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ingredient_resaleProductId_key" ON "ingredient"("resaleProductId");
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_resaleProductId_fkey"
  FOREIGN KEY ("resaleProductId") REFERENCES "product"("id") ON DELETE SET NULL;

-- Mercado -> Fornecedor (rename, dados preservados)
ALTER TABLE "market" RENAME TO "supplier";
ALTER TABLE "supplier" RENAME CONSTRAINT "market_pkey" TO "supplier_pkey";
ALTER TABLE "supplier" RENAME CONSTRAINT "market_workspaceId_fkey" TO "supplier_workspaceId_fkey";
ALTER INDEX "market_workspaceId_name_key" RENAME TO "supplier_workspaceId_name_key";

-- Compra: cabeçalho (Purchase) + itens (PurchaseItem), fornecedor opcional
CREATE TABLE "purchase" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT,
    "userId" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_item" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "BaseUnit" NOT NULL,
    "pricePaidCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "purchase_item_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase" ADD CONSTRAINT "purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE SET NULL;
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL;
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredient"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE;

CREATE INDEX "purchase_workspaceId_purchasedAt_idx" ON "purchase"("workspaceId", "purchasedAt");
CREATE INDEX "purchase_item_workspaceId_ingredientId_idx" ON "purchase_item"("workspaceId", "ingredientId");

-- Migra dados: cada ingredient_purchase vira um Purchase de 1 item (histórico preservado)
INSERT INTO "purchase" ("id", "supplierId", "userId", "purchasedAt", "createdAt", "workspaceId")
SELECT "id" || '_hdr', "marketId", "userId", "purchasedAt", "createdAt", "workspaceId"
FROM "ingredient_purchase";

INSERT INTO "purchase_item" ("id", "purchaseId", "ingredientId", "quantity", "unit", "pricePaidCents", "createdAt", "workspaceId")
SELECT "id", "id" || '_hdr', "ingredientId", "quantity", "unit", "pricePaidCents", "createdAt", "workspaceId"
FROM "ingredient_purchase";

DROP TABLE "ingredient_purchase";

-- Novo tipo de movimento de estoque: entrada por compra de insumo de revenda
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'PURCHASE';
