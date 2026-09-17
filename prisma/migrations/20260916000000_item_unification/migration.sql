BEGIN;

-- 0. Pré-voo: "product" e "ingredient" passam a dividir o mesmo namespace de nome
--    (@@unique([workspaceId, name]) em Item). Se houver colisão, falhar aqui — legível —
--    em vez de abortar no meio da migração com uma violação de unique constraint.
--    O par esperado (insumo de revenda + seu Product pareado) é excluído da checagem.
DO $$
DECLARE
  colisoes TEXT;
BEGIN
  SELECT string_agg(DISTINCT format('%s (workspace %s)', p.name, p."workspaceId"), ', ')
    INTO colisoes
  FROM "product" p
  JOIN "ingredient" ing
    ON ing."workspaceId" = p."workspaceId"
   AND lower(ing.name) = lower(p.name)
  WHERE ing."resaleProductId" IS DISTINCT FROM p.id;

  IF colisoes IS NOT NULL THEN
    RAISE EXCEPTION 'Migração abortada: nomes colidem entre "product" e "ingredient" no mesmo workspace: %', colisoes
      USING HINT = 'Renomeie um dos dois lados antes de rodar esta migração.';
  END IF;
END
$$;

-- 1. Product vira a base física de Item
ALTER TABLE "product" RENAME TO "item";
ALTER TABLE "item" ADD COLUMN "unit" "BaseUnit" NOT NULL DEFAULT 'UN';
ALTER TABLE "item" ADD COLUMN "sellable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "item" ADD COLUMN "productionInput" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "item" ADD COLUMN "minStock" DOUBLE PRECISION DEFAULT 0;

-- 2. Novo tipo de movimento de estoque
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'CONSUMPTION';

-- 3. FKs que apontam para "ingredient" saem antes do repontamento de dados do passo 4
ALTER TABLE "purchase_item" DROP CONSTRAINT "purchase_item_ingredientId_fkey";
ALTER TABLE "recipe_ingredient" DROP CONSTRAINT "recipe_ingredient_ingredientId_fkey";
ALTER TABLE "shopping_list_item" DROP CONSTRAINT "shopping_list_item_ingredientId_fkey";

-- 4. Insumos de revenda (Ingredient + Product pareado) se fundem no Item existente.
--    O sinal do pareamento é "resaleProductId IS NOT NULL", NÃO "forResale = true": o
--    syncResaleProduct antigo deixava o resaleProductId preenchido depois que o usuário
--    desmarcava revenda, então uma linha (forResale=false, resaleProductId != null) é um
--    par real e precisa se fundir — senão ela sobreviveria até o INSERT do passo 5 e
--    colidiria por nome com o próprio Product órfão dela.
--    O pareamento sempre foi intra-workspace; o join com "item" garante isso.
UPDATE "item" i
SET "unit" = ing."baseUnit",
    "productionInput" = ing."isRawMaterial",
    "minStock" = ing."minStock",
    "sellable" = true
FROM "ingredient" ing
WHERE ing."resaleProductId" = i.id
  AND ing."workspaceId" = i."workspaceId";

UPDATE "purchase_item" pi
SET "ingredientId" = ing."resaleProductId"
FROM "ingredient" ing
JOIN "item" i ON i.id = ing."resaleProductId"
WHERE pi."ingredientId" = ing.id
  AND ing."resaleProductId" IS NOT NULL
  AND ing."workspaceId" = i."workspaceId";

UPDATE "recipe_ingredient" ri
SET "ingredientId" = ing."resaleProductId"
FROM "ingredient" ing
JOIN "item" i ON i.id = ing."resaleProductId"
WHERE ri."ingredientId" = ing.id
  AND ing."resaleProductId" IS NOT NULL
  AND ing."workspaceId" = i."workspaceId";

UPDATE "shopping_list_item" sli
SET "ingredientId" = ing."resaleProductId"
FROM "ingredient" ing
JOIN "item" i ON i.id = ing."resaleProductId"
WHERE sli."ingredientId" = ing.id
  AND ing."resaleProductId" IS NOT NULL
  AND ing."workspaceId" = i."workspaceId";

DELETE FROM "ingredient" ing
USING "item" i
WHERE i.id = ing."resaleProductId"
  AND ing."workspaceId" = i."workspaceId";

-- 5. Insumos puros (matéria-prima sem Product pareado) viram novas linhas de Item,
--    preservando o MESMO id (assim as colunas *_ingredient_id não precisam remapear valor, só nome)
INSERT INTO "item" (id, "workspaceId", name, active, "createdAt", "updatedAt", "unit", "sellable", "productionInput", "minStock")
SELECT id, "workspaceId", name, true, "createdAt", "updatedAt", "baseUnit", false, "isRawMaterial", "minStock"
FROM "ingredient";

DROP TABLE "ingredient";

-- 6. Renomeia colunas de FK nas tabelas dependentes
ALTER TABLE "purchase_item" RENAME COLUMN "ingredientId" TO "itemId";
ALTER TABLE "recipe_ingredient" RENAME COLUMN "ingredientId" TO "itemId";
ALTER TABLE "shopping_list_item" RENAME COLUMN "ingredientId" TO "itemId";
ALTER TABLE "sale_item" RENAME COLUMN "productId" TO "itemId";
ALTER TABLE "price_list_item" RENAME COLUMN "productId" TO "itemId";
ALTER TABLE "stock_movement" RENAME COLUMN "productId" TO "itemId";
ALTER TABLE "production_batch" RENAME COLUMN "productId" TO "itemId";
ALTER TABLE "flavor" RENAME COLUMN "productId" TO "itemId";

ALTER TABLE "purchase_item"
  ADD CONSTRAINT "purchase_item_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_ingredient"
  ADD CONSTRAINT "recipe_item_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shopping_list_item"
  ADD CONSTRAINT "shopping_list_item_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Renomeações de tabela (Flavor -> Variant, RecipeIngredient -> RecipeItem, ProductionFilling -> ProductionVariantLine)
ALTER TABLE "flavor" RENAME TO "variant";
ALTER TABLE "variant" RENAME COLUMN "fillingRecipeId" TO "recipeId";
ALTER TABLE "recipe_ingredient" RENAME TO "recipe_item";
ALTER TABLE "production_filling" RENAME TO "production_variant_line";

-- 8. flavorId -> variantId em todas as tabelas que referenciam Variant
ALTER TABLE "production_variant_line" RENAME COLUMN "flavorId" TO "variantId";
ALTER TABLE "production_batch" RENAME COLUMN "flavorId" TO "variantId";
ALTER TABLE "sale_item" RENAME COLUMN "flavorId" TO "variantId";
ALTER TABLE "price_list_item" RENAME COLUMN "flavorId" TO "variantId";
ALTER TABLE "stock_movement" RENAME COLUMN "flavorId" TO "variantId";

-- 9. Lista de compras: campo autoGenerated sai do modelo (redesenho do fluxo, Task 11)
ALTER TABLE "shopping_list_item" DROP COLUMN "autoGenerated";

-- 10. RENAME TO não renomeia constraints/índices autogerados: alinhar com os nomes que o Prisma espera
ALTER TABLE "item" RENAME CONSTRAINT "product_pkey" TO "item_pkey";
ALTER TABLE "production_variant_line" RENAME CONSTRAINT "production_filling_pkey" TO "production_variant_line_pkey";
ALTER TABLE "recipe_item" RENAME CONSTRAINT "recipe_ingredient_pkey" TO "recipe_item_pkey";
ALTER TABLE "variant" RENAME CONSTRAINT "flavor_pkey" TO "variant_pkey";

ALTER TABLE "item" RENAME CONSTRAINT "product_workspaceId_fkey" TO "item_workspaceId_fkey";
ALTER TABLE "price_list_item" RENAME CONSTRAINT "price_list_item_flavorId_fkey" TO "price_list_item_variantId_fkey";
ALTER TABLE "price_list_item" RENAME CONSTRAINT "price_list_item_productId_fkey" TO "price_list_item_itemId_fkey";
ALTER TABLE "production_batch" RENAME CONSTRAINT "production_batch_flavorId_fkey" TO "production_batch_variantId_fkey";
ALTER TABLE "production_batch" RENAME CONSTRAINT "production_batch_productId_fkey" TO "production_batch_itemId_fkey";
ALTER TABLE "production_variant_line" RENAME CONSTRAINT "production_filling_flavorId_fkey" TO "production_variant_line_variantId_fkey";
ALTER TABLE "production_variant_line" RENAME CONSTRAINT "production_filling_productionBatchId_fkey" TO "production_variant_line_productionBatchId_fkey";
ALTER TABLE "production_variant_line" RENAME CONSTRAINT "production_filling_workspaceId_fkey" TO "production_variant_line_workspaceId_fkey";
ALTER TABLE "recipe_item" RENAME CONSTRAINT "recipe_ingredient_recipeId_fkey" TO "recipe_item_recipeId_fkey";
ALTER TABLE "recipe_item" RENAME CONSTRAINT "recipe_ingredient_workspaceId_fkey" TO "recipe_item_workspaceId_fkey";
ALTER TABLE "sale_item" RENAME CONSTRAINT "sale_item_flavorId_fkey" TO "sale_item_variantId_fkey";
ALTER TABLE "sale_item" RENAME CONSTRAINT "sale_item_productId_fkey" TO "sale_item_itemId_fkey";
ALTER TABLE "stock_movement" RENAME CONSTRAINT "stock_movement_flavorId_fkey" TO "stock_movement_variantId_fkey";
ALTER TABLE "stock_movement" RENAME CONSTRAINT "stock_movement_productId_fkey" TO "stock_movement_itemId_fkey";
ALTER TABLE "variant" RENAME CONSTRAINT "flavor_fillingRecipeId_fkey" TO "variant_recipeId_fkey";
ALTER TABLE "variant" RENAME CONSTRAINT "flavor_productId_fkey" TO "variant_itemId_fkey";
ALTER TABLE "variant" RENAME CONSTRAINT "flavor_workspaceId_fkey" TO "variant_workspaceId_fkey";

ALTER INDEX "product_workspaceId_name_key" RENAME TO "item_workspaceId_name_key";
ALTER INDEX "price_list_item_productId_flavorId_key" RENAME TO "price_list_item_itemId_variantId_key";
ALTER INDEX "production_filling_workspaceId_idx" RENAME TO "production_variant_line_workspaceId_idx";
ALTER INDEX "purchase_item_workspaceId_ingredientId_idx" RENAME TO "purchase_item_workspaceId_itemId_idx";
ALTER INDEX "recipe_ingredient_recipeId_ingredientId_key" RENAME TO "recipe_item_recipeId_itemId_key";
ALTER INDEX "recipe_ingredient_workspaceId_idx" RENAME TO "recipe_item_workspaceId_idx";
ALTER INDEX "stock_movement_workspaceId_productId_flavorId_idx" RENAME TO "stock_movement_workspaceId_itemId_variantId_idx";
ALTER INDEX "flavor_productId_name_key" RENAME TO "variant_itemId_name_key";
ALTER INDEX "flavor_workspaceId_idx" RENAME TO "variant_workspaceId_idx";

COMMIT;
