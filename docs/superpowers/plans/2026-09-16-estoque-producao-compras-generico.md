# Estoque, Produção e Lista de Compras genéricos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fundir `Product`+`Ingredient` num único modelo `Item`, fazer `StockMovement` virar a fonte única de verdade do saldo de estoque, e trocar a lista de compras de "gerada automaticamente" para CRUD livre com sugestões opt-in.

**Architecture:** Uma migração SQL escrita à mão (não `prisma migrate dev`) funde as tabelas e renomeia campos preservando todo histórico; a partir daí, cada módulo de servidor (queries + actions) é reescrito contra o novo schema, e por fim a UI é atualizada para o novo vocabulário e para o novo fluxo de lista de compras.

**Tech Stack:** Next.js App Router, Prisma + PostgreSQL, TypeScript, Vitest, pnpm.

**Spec:** [docs/superpowers/specs/2026-09-16-estoque-producao-compras-generico-design.md](/Users/ferrari/code/coolkies-system/docs/superpowers/specs/2026-09-16-estoque-producao-compras-generico-design.md)

## Global Constraints

- Use `pnpm`, nunca `npm`/`yarn` (disco do ambiente vive perto de 100%; já quebrou antes).
- Migrations são escritas à mão. **Nunca rode `prisma migrate dev`.** Aplique o SQL via `docker psql` diretamente nos bancos `cookies` (dev) e `cookies_test`.
- Todo item vendável (`sellable=true`) precisa ter `unit=UN` — `SaleItem.quantity` é `Int` (contagem de unidades inteiras), então venda fracionada (peso/volume) não é suportada; essa restrição já existia hoje via `forResale && baseUnit !== UN` e continua valendo, só que expressa em cima de `sellable`/`unit`.
- Nenhum dado histórico (venda, compra, produção) pode perder referência durante a migração — todo remap é de coluna/tabela, nunca de valor de FK, exceto o repoint pontual de insumos de revenda (item→item já existente, ver Task 1).
- Não mexer no catálogo multi-dimensão, na metodologia de custeio, ou em unificar as telas `/admin/catalog`/`/admin/ingredients` numa só — fora de escopo (ver spec).

---

## Task 1: Migração de schema (Item unificado + renomeações)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/manual-migrations/2026-09-16-item-unification.sql`
- Test: verificação manual via query (não há suite automatizada para a migração em si — a Task 2 cobre a parte automatizável)

**Interfaces:**
- Produces: modelo `Item` (substitui `Product`+`Ingredient`), `Variant` (ex-`Flavor`), `RecipeItem` (ex-`RecipeIngredient`), `ProductionVariantLine` (ex-`ProductionFilling`), `StockMovementType.CONSUMPTION`. Todo model subsequente (`PurchaseItem.itemId`, `SaleItem.itemId`/`variantId`, `PriceListItem.itemId`/`variantId`, `StockMovement.itemId`/`variantId`, `ProductionBatch.itemId`/`variantId`, `ShoppingListItem.itemId`) depende destes nomes exatos.

- [ ] **Step 1: Checar colisão de nomes entre Product e Ingredient por workspace**

Antes de qualquer coisa, rode esta query manualmente contra o banco `cookies` (e `cookies_test`) — se ela retornar alguma linha, **pare** e resolva a colisão renomeando um dos dois antes de continuar (a migração vai unificar os dois namespaces de nome num só `@@unique([workspaceId, name])`):

```sql
SELECT p."workspaceId", p.name AS product_name, i.name AS ingredient_name
FROM "product" p
JOIN "ingredient" i ON i."workspaceId" = p."workspaceId" AND lower(i.name) = lower(p.name)
WHERE NOT (i."forResale" = true AND i."resaleProductId" = p.id); -- exclui o par já esperado (insumo de revenda com o mesmo nome do seu Product pareado)
```

- [ ] **Step 2: Escrever a migração SQL completa**

Crie `prisma/manual-migrations/2026-09-16-item-unification.sql`:

```sql
BEGIN;

-- 1. Product vira a base física de Item
ALTER TABLE "product" RENAME TO "item";
ALTER TABLE "item" ADD COLUMN "unit" "BaseUnit" NOT NULL DEFAULT 'UN';
ALTER TABLE "item" ADD COLUMN "sellable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "item" ADD COLUMN "productionInput" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "item" ADD COLUMN "minStock" DOUBLE PRECISION;

-- 2. Novo tipo de movimento de estoque
ALTER TYPE "StockMovementType" ADD VALUE 'CONSUMPTION';

-- 3. Insumos de revenda (Ingredient + Product pareado) se fundem no Item existente
UPDATE "item" i
SET "unit" = ing."baseUnit",
    "productionInput" = ing."isRawMaterial",
    "minStock" = ing."minStock"
FROM "ingredient" ing
WHERE ing."resaleProductId" = i.id
  AND ing."forResale" = true;

UPDATE "purchase_item" pi
SET "ingredientId" = ing."resaleProductId"
FROM "ingredient" ing
WHERE pi."ingredientId" = ing.id AND ing."forResale" = true AND ing."resaleProductId" IS NOT NULL;

UPDATE "recipe_ingredient" ri
SET "ingredientId" = ing."resaleProductId"
FROM "ingredient" ing
WHERE ri."ingredientId" = ing.id AND ing."forResale" = true AND ing."resaleProductId" IS NOT NULL;

UPDATE "shopping_list_item" sli
SET "ingredientId" = ing."resaleProductId"
FROM "ingredient" ing
WHERE sli."ingredientId" = ing.id AND ing."forResale" = true AND ing."resaleProductId" IS NOT NULL;

DELETE FROM "ingredient" WHERE "forResale" = true AND "resaleProductId" IS NOT NULL;

-- 4. Insumos puros (matéria-prima sem Product pareado) viram novas linhas de Item,
--    preservando o MESMO id (assim as colunas *_ingredient_id não precisam remapear valor, só nome)
INSERT INTO "item" (id, "workspaceId", name, active, "createdAt", "updatedAt", "unit", "sellable", "productionInput", "minStock")
SELECT id, "workspaceId", name, true, "createdAt", "updatedAt", "baseUnit", false, "isRawMaterial", "minStock"
FROM "ingredient";

DROP TABLE "ingredient";

-- 5. Renomeia colunas de FK nas tabelas dependentes
ALTER TABLE "purchase_item" RENAME COLUMN "ingredientId" TO "itemId";
ALTER TABLE "recipe_ingredient" RENAME COLUMN "ingredientId" TO "itemId";
ALTER TABLE "shopping_list_item" RENAME COLUMN "ingredientId" TO "itemId";
ALTER TABLE "sale_item" RENAME COLUMN "productId" TO "itemId";
ALTER TABLE "price_list_item" RENAME COLUMN "productId" TO "itemId";
ALTER TABLE "stock_movement" RENAME COLUMN "productId" TO "itemId";
ALTER TABLE "production_batch" RENAME COLUMN "productId" TO "itemId";
ALTER TABLE "flavor" RENAME COLUMN "productId" TO "itemId";

-- 6. Renomeações de tabela (Flavor -> Variant, RecipeIngredient -> RecipeItem, ProductionFilling -> ProductionVariantLine)
ALTER TABLE "flavor" RENAME TO "variant";
ALTER TABLE "variant" RENAME COLUMN "fillingRecipeId" TO "recipeId";
ALTER TABLE "recipe_ingredient" RENAME TO "recipe_item";
ALTER TABLE "production_filling" RENAME TO "production_variant_line";

-- 7. flavorId -> variantId em todas as tabelas que referenciam Variant
ALTER TABLE "production_variant_line" RENAME COLUMN "flavorId" TO "variantId";
ALTER TABLE "production_batch" RENAME COLUMN "flavorId" TO "variantId";
ALTER TABLE "sale_item" RENAME COLUMN "flavorId" TO "variantId";
ALTER TABLE "price_list_item" RENAME COLUMN "flavorId" TO "variantId";
ALTER TABLE "stock_movement" RENAME COLUMN "flavorId" TO "variantId";

-- 8. Lista de compras: campo autoGenerated sai do modelo (redesenho do fluxo, Task 11)
ALTER TABLE "shopping_list_item" DROP COLUMN "autoGenerated";

COMMIT;
```

- [ ] **Step 3: Aplicar em `cookies_test` primeiro**

```bash
docker exec -i <container_postgres> psql -U <user> -d cookies_test < prisma/manual-migrations/2026-09-16-item-unification.sql
```

(troque `<container_postgres>`/`<user>` pelos valores reais do projeto — confira em `docker ps` / `.env` se não souber de cor.)

- [ ] **Step 4: Verificar contagens pós-migração em `cookies_test`**

```sql
SELECT
  (SELECT count(*) FROM "item") AS items,
  (SELECT count(*) FROM "variant") AS variants,
  (SELECT count(*) FROM "recipe_item") AS recipe_items,
  (SELECT count(*) FROM "production_variant_line") AS prod_variant_lines;
-- items deve ser igual a (contagem antiga de product) + (contagem antiga de ingredient com forResale=false)
```

- [ ] **Step 5: Aplicar em `cookies` (dev/produção) do mesmo jeito**

Repita os Steps 3–4 apontando para o banco `cookies`.

- [ ] **Step 6: Atualizar `prisma/schema.prisma`**

Substitua os models `Product`, `Ingredient`, `Flavor`, `RecipeIngredient`, `ProductionFilling` pelo schema abaixo (mantenha todos os outros models como estão, só ajustando as relações que apontavam para os antigos nomes):

```prisma
model Item {
  id        String   @id @default(cuid())
  name      String
  active    Boolean  @default(true)
  unit      BaseUnit @default(UN)
  sellable        Boolean @default(true)  // aparece em catálogo/preço, pode ser vendido
  productionInput Boolean @default(false) // pode ser usado como insumo de uma Recipe
  minStock  Float?   @default(0) // estoque mínimo na unidade base (para alertas)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  variants       Variant[]
  priceListItems PriceListItem[]
  saleItems      SaleItem[]
  stockMovements StockMovement[]
  productionBatches ProductionBatch[]
  purchaseItems     PurchaseItem[]
  recipeItems       RecipeItem[]
  shoppingItems     ShoppingListItem[]

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, name])
  @@map("item")
}

model Variant {
  id        String   @id @default(cuid())
  name      String
  active    Boolean  @default(true)
  itemId    String
  item      Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)

  // Receita adicional aplicada especificamente a esta variante (ex.: recheio)
  recipeId  String?
  recipe    Recipe? @relation("VariantRecipe", fields: [recipeId], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  priceListItems PriceListItem[]
  saleItems      SaleItem[]
  stockMovements StockMovement[]
  productionBatches ProductionBatch[]
  productionVariantLines ProductionVariantLine[]

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([itemId, name])
  @@index([workspaceId])
  @@map("variant")
}
```

No model `Recipe`, troque a linha `flavorFillings Flavor[] @relation("FlavorFillingRecipe")` por `variantRecipes Variant[] @relation("VariantRecipe")`, e troque `ingredients RecipeIngredient[]` por `items RecipeItem[]`.

Substitua `RecipeIngredient` por:

```prisma
model RecipeItem {
  id       String @id @default(cuid())
  recipeId String
  recipe   Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  itemId   String
  item     Item   @relation(fields: [itemId], references: [id])
  quantity Float

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([recipeId, itemId])
  @@index([workspaceId])
  @@map("recipe_item")
}
```

Substitua `ProductionFilling` por:

```prisma
model ProductionVariantLine {
  id                String          @id @default(cuid())
  productionBatchId String
  productionBatch   ProductionBatch @relation(fields: [productionBatchId], references: [id], onDelete: Cascade)
  variantId         String
  variant           Variant         @relation(fields: [variantId], references: [id])
  quantity          Int

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@map("production_variant_line")
}
```

Em `ProductionBatch`, `PurchaseItem`, `PriceListItem`, `SaleItem`, `StockMovement`: troque `productId`/`product` → `itemId`/`item` (relation para `Item`), e `flavorId`/`flavor` → `variantId`/`variant` (relation para `Variant`). Em `ProductionBatch`, troque `movements StockMovement[]` e `fillings ProductionFilling[]` por `variantLines ProductionVariantLine[]`.

No `StockMovementType`, adicione `CONSUMPTION`:

```prisma
enum StockMovementType {
  PRODUCTION
  CONSUMPTION
  SALE
  ADJUSTMENT
  PURCHASE
}
```

Em `ShoppingListItem`, troque `ingredientId`/`ingredient` → `itemId`/`item`, e remova o campo `autoGenerated`.

No model `Workspace`, atualize a lista de relations: remova `products`, `flavors`, `ingredients`, adicione `items Item[]` e `variants Variant[]`; renomeie `recipeIngredients` → `recipeItems`, `productionFillings` → `productionVariantLines`.

- [ ] **Step 7: Regenerar o client Prisma**

```bash
pnpm prisma generate
```

- [ ] **Step 8: Validar o schema contra o banco já migrado**

```bash
pnpm prisma validate
pnpm prisma db pull --print > /tmp/introspected.prisma
```

Compare visualmente `/tmp/introspected.prisma` com `prisma/schema.prisma` — devem bater nos nomes de tabela/coluna (a introspecção não preserva nomes de relation/model TS, só a forma física; é essa forma física que precisa bater).

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/manual-migrations/2026-09-16-item-unification.sql
git commit -m "$(cat <<'EOF'
feat(schema): unifica Product+Ingredient em Item, StockMovement vira fonte única de estoque

Migração escrita à mão (aplicada via docker psql em cookies e cookies_test).
Flavor->Variant, RecipeIngredient->RecipeItem, ProductionFilling->ProductionVariantLine.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

O projeto inteiro fica sem compilar depois deste commit (todo o resto do código ainda referencia `db.product`/`db.ingredient`/`db.flavor` etc.) — isso é esperado e resolvido pelas próximas tasks. Não faça deploy nem rode a suíte completa entre esta task e a Task 15.

---

## Task 2: Atualizar infraestrutura de teste e scripts para o novo schema

**Files:**
- Modify: `src/test/db.ts`
- Modify: `scripts/domain-tables.ts`

**Interfaces:**
- Consumes: nomes de tabela física definidos na Task 1 (`item`, `variant`, `recipe_item`, `production_variant_line`).
- Produces: `resetDb()` funcional para todos os testes das próximas tasks.

- [ ] **Step 1: Atualizar `TABLES` em `src/test/db.ts`**

```ts
const TABLES = [
  "member",
  "invitation",
  "workspace",
  "user",
  "processed_webhook_event",
  "stock_movement",
  "production_variant_line",
  "production_batch",
  "shopping_list_item",
  "recipe_item",
  "purchase_item",
  "purchase",
  "sale_item",
  "sale",
  "price_history",
  "price_list_item",
  "variant",
  "item",
  "recipe",
  "supplier",
  "customer",
];
```

- [ ] **Step 2: Atualizar `DOMAIN_TABLES` em `scripts/domain-tables.ts`**

```ts
export const DOMAIN_TABLES = [
  "item", "variant", "price_list_item", "price_history", "customer",
  "sale", "sale_item", "supplier",
  "recipe", "recipe_item", "production_batch", "production_variant_line",
  "stock_movement", "shopping_list_item",
];
```

(Removidas `"market"` e `"ingredient_purchase"` — já não existem no schema atual, eram resíduo de uma iteração anterior.)

- [ ] **Step 3: Rodar um teste qualquer que use `resetDb()` pra confirmar que o truncate não quebra**

```bash
pnpm vitest run src/server/tenant/extension.test.ts
```

Espera-se que ainda FALHE (esse teste referencia `testDb.product`, corrigido na Task 15) — mas o `resetDb()` em si não deve lançar erro de "tabela não existe". Se lançar, revise a lista de `TABLES`.

- [ ] **Step 4: Commit**

```bash
git add src/test/db.ts scripts/domain-tables.ts
git commit -m "$(cat <<'EOF'
chore(test): atualiza tabelas de reset/backfill para o schema Item unificado

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Saldo de estoque unificado via StockMovement (`getItemStock`)

**Files:**
- Modify: `src/server/queries/production.ts` (remove `getPantryStock`/`getCookieStock`, adiciona `getItemStock`)
- Test: `src/server/queries/production.test.ts` (novo arquivo)

**Interfaces:**
- Consumes: `getWorkspaceDb()` de `@/server/tenant/context`; `unitCostFromLastPurchase` de `./purchase-cost`; `isLowStock` de `@/lib/stock`.
- Produces: `getItemStock(): Promise<ItemStockEntry[]>` — consumida pela Task 12 (página `/stock`).

```ts
export type ItemStockEntry = {
  itemId: string;
  itemName: string;
  variantId: string | null;
  variantName: string | null;
  unit: string;
  current: number;
  minStock: number | null;
  belowMin: boolean;
  sellable: boolean;
  productionInput: boolean;
  latestPriceCents: number | null;
  latestSupplier: string | null;
};
```

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `src/server/queries/production.test.ts`. O padrão de teste usado no repo para queries que chamam `getWorkspaceDb()` é mockar `@/server/tenant/context` inteiro com um objeto `context` mutável (ver `src/server/queries/dashboard.test.ts:1-17` para o exemplo real) — **não existe** nenhum helper `runAsWorkspace`/`runAsUser` pronto no repo; siga exatamente este padrão:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

const context = { workspaceId: "" };

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
}));

const { getItemStock } = await import("./production");

beforeEach(async () => {
  await resetDb();
});

describe("getItemStock", () => {
  it("soma StockMovement por item sem variante", async () => {
    const ws = await createWorkspace("Loja A");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({
      data: { name: "Açúcar", workspaceId: ws.id, unit: "G", productionInput: true, sellable: false, minStock: 500 },
    });
    await testDb.stockMovement.create({
      data: { itemId: item.id, type: "PURCHASE", quantity: 1000, workspaceId: ws.id },
    });
    await testDb.stockMovement.create({
      data: { itemId: item.id, type: "CONSUMPTION", quantity: -300, workspaceId: ws.id },
    });

    const stock = await getItemStock();

    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({
      itemId: item.id,
      current: 700,
      belowMin: false,
      variantId: null,
    });
  });

  it("agrupa por variante quando o item tem variantes", async () => {
    const ws = await createWorkspace("Loja B");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({
      data: { name: "Cookie", workspaceId: ws.id, sellable: true, unit: "UN" },
    });
    const choc = await testDb.variant.create({ data: { name: "Chocolate", itemId: item.id, workspaceId: ws.id } });
    const trad = await testDb.variant.create({ data: { name: "Tradicional", itemId: item.id, workspaceId: ws.id } });
    await testDb.stockMovement.create({ data: { itemId: item.id, variantId: choc.id, type: "PRODUCTION", quantity: 10, workspaceId: ws.id } });
    await testDb.stockMovement.create({ data: { itemId: item.id, variantId: choc.id, type: "SALE", quantity: -3, workspaceId: ws.id } });
    await testDb.stockMovement.create({ data: { itemId: item.id, variantId: trad.id, type: "PRODUCTION", quantity: 5, workspaceId: ws.id } });

    const stock = await getItemStock();

    expect(stock).toHaveLength(2);
    const chocEntry = stock.find((s) => s.variantId === choc.id);
    const tradEntry = stock.find((s) => s.variantId === trad.id);
    expect(chocEntry?.current).toBe(7);
    expect(tradEntry?.current).toBe(5);
  });

  it("marca belowMin quando o saldo fica abaixo do mínimo", async () => {
    const ws = await createWorkspace("Loja C");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({
      data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, minStock: 1000 },
    });
    await testDb.stockMovement.create({ data: { itemId: item.id, type: "PURCHASE", quantity: 500, workspaceId: ws.id } });

    const stock = await getItemStock();
    expect(stock[0].belowMin).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run src/server/queries/production.test.ts
```

Esperado: FALHA (`getItemStock` ainda não existe).

- [ ] **Step 3: Remover `getPantryStock`, `getCookieStock` e `buildConsumptionMap`; adicionar `getItemStock`**

Em `src/server/queries/production.ts`, remova as funções `getPantryStock`, `getCookieStock`, `buildConsumptionMap` e os tipos `CookieStockEntry`/`PantryEntry` por inteiro, e adicione:

```ts
export type ItemStockEntry = {
  itemId: string;
  itemName: string;
  variantId: string | null;
  variantName: string | null;
  unit: string;
  current: number;
  minStock: number | null;
  belowMin: boolean;
  sellable: boolean;
  productionInput: boolean;
  latestPriceCents: number | null;
  latestSupplier: string | null;
};

export async function getItemStock(): Promise<ItemStockEntry[]> {
  const db = await getWorkspaceDb();
  const items = await db.item.findMany({
    orderBy: { name: "asc" },
    include: {
      variants: { orderBy: { name: "asc" } },
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        include: { purchase: { select: { supplier: { select: { name: true } } } } },
      },
    },
  });

  const balances = await db.stockMovement.groupBy({
    by: ["itemId", "variantId"],
    _sum: { quantity: true },
  });
  const balanceMap = new Map(
    balances.map((b) => [`${b.itemId}|${b.variantId ?? ""}`, b._sum.quantity ?? 0]),
  );

  const entries: ItemStockEntry[] = [];
  for (const item of items) {
    const lastPurchase = item.purchaseItems[0] ?? null;
    const pricePerUnit = unitCostFromLastPurchase(lastPurchase);
    const latestPriceCents = pricePerUnit !== null ? Math.round(pricePerUnit) : null;
    const latestSupplier = lastPurchase?.purchase.supplier?.name ?? null;
    const base = {
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      minStock: item.minStock ?? null,
      sellable: item.sellable,
      productionInput: item.productionInput,
      latestPriceCents,
      latestSupplier,
    };

    if (item.variants.length === 0) {
      const current = balanceMap.get(`${item.id}|`) ?? 0;
      entries.push({ ...base, variantId: null, variantName: null, current, belowMin: isLowStock(current, item.minStock) });
    } else {
      for (const variant of item.variants) {
        const current = balanceMap.get(`${item.id}|${variant.id}`) ?? 0;
        entries.push({ ...base, variantId: variant.id, variantName: variant.name, current, belowMin: isLowStock(current, item.minStock) });
      }
    }
  }
  return entries;
}
```

Adicione o import `import { isLowStock } from "@/lib/stock";` no topo do arquivo se ainda não estiver presente.

Também troque, em `getProductionBatches`/`getProductionBatchById` (mesmo arquivo), `product`/`flavor`/`fillings` pelos novos nomes:

```ts
export async function getProductionBatches() {
  const db = await getWorkspaceDb();
  return db.productionBatch.findMany({
    orderBy: { producedAt: "desc" },
    include: {
      item: { select: { id: true, name: true } },
      variant: { select: { id: true, name: true } },
      recipe: { select: { id: true, name: true, yieldQty: true } },
      variantLines: {
        include: { variant: { select: { id: true, name: true } } },
      },
    },
  });
}

export async function getProductionBatchById(id: string) {
  const db = await getWorkspaceDb();
  return db.productionBatch.findUnique({
    where: { id },
    include: {
      variantLines: { select: { variantId: true, quantity: true } },
    },
  });
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

```bash
pnpm vitest run src/server/queries/production.test.ts
```

Esperado: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/server/queries/production.ts src/server/queries/production.test.ts
git commit -m "$(cat <<'EOF'
feat(estoque): getItemStock substitui getPantryStock/getCookieStock via StockMovement

Saldo de qualquer item (insumo ou vendável, com ou sem variante) passa a ser
sempre Σ StockMovement, eliminando as duas lógicas de recálculo na leitura.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Produção grava StockMovement (PRODUCTION + CONSUMPTION) na escrita

**Files:**
- Modify: `src/server/actions/production.ts`
- Test: `src/server/actions/production.test.ts` (novo arquivo)

**Interfaces:**
- Consumes: `getItemStock` (Task 3) para os testes de asserção de saldo.
- Produces: `createProductionBatch`, `updateProductionBatch`, `deleteProductionBatch` — mesma assinatura pública (`FormData` → `ActionResult`), campos de formulário renomeados: `productId`→`itemId`, `fillings`→`variantLines` (JSON `{variantId, quantity}[]`).

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `src/server/actions/production.test.ts`, seguindo o mesmo padrão de `vi.mock("@/server/tenant/context", ...)` usado em `src/server/actions/purchases.test.ts:1-24` (mock com objeto `context` mutável para `workspaceId`/`userId`/`canWrite`, e `getWorkspaceDb` mockado também porque `getItemStock` é chamado dentro dos testes para verificar o saldo):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "", canWrite: true };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({
    db: scopedDb(context.workspaceId),
    workspaceId: context.workspaceId,
    userId: context.userId,
    role: "OWNER",
    canWrite: context.canWrite,
  }),
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
  assertCanWrite: async () => {
    if (!context.canWrite) throw new Error("Este workspace está em modo somente leitura.");
  },
}));

const { createProductionBatch, deleteProductionBatch } = await import("./production");
const { getItemStock } = await import("@/server/queries/production");

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(async () => {
  await resetDb();
  context.canWrite = true;
});

describe("createProductionBatch", () => {
  it("grava StockMovement(PRODUCTION) para item sem variante e sem receita", async () => {
    const ws = await createWorkspace("Loja A");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Vela", workspaceId: ws.id, sellable: true, unit: "UN" } });

    const res = await createProductionBatch(fd({ itemId: item.id, quantity: "10", producedAt: "2026-09-16" }));
    expect(res.ok).toBe(true);

    const stock = await getItemStock();
    expect(stock.find((s) => s.itemId === item.id)?.current).toBe(10);
  });

  it("grava CONSUMPTION dos insumos da receita proporcional à quantidade produzida", async () => {
    const ws = await createWorkspace("Loja B");
    context.workspaceId = ws.id;
    const flour = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true } });
    const output = await testDb.item.create({ data: { name: "Pão", workspaceId: ws.id, sellable: true, unit: "UN" } });
    const recipe = await testDb.recipe.create({
      data: { name: "Pão base", yieldQty: 2, workspaceId: ws.id, items: { create: [{ itemId: flour.id, quantity: 100, workspaceId: ws.id }] } },
    });
    await testDb.stockMovement.create({ data: { itemId: flour.id, type: "PURCHASE", quantity: 1000, workspaceId: ws.id } });

    const res = await createProductionBatch(fd({ itemId: output.id, recipeId: recipe.id, quantity: "6", producedAt: "2026-09-16" }));
    expect(res.ok).toBe(true);

    const stock = await getItemStock();
    // 6 pães / yieldQty 2 = 3 "lotes" de receita × 100g farinha = 300g consumidos
    expect(stock.find((s) => s.itemId === flour.id)?.current).toBe(700);
    expect(stock.find((s) => s.itemId === output.id)?.current).toBe(6);
  });

  it("distribui entre variantes e grava um StockMovement por variante", async () => {
    const ws = await createWorkspace("Loja C");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Cookie", workspaceId: ws.id, sellable: true, unit: "UN" } });
    const choc = await testDb.variant.create({ data: { name: "Chocolate", itemId: item.id, workspaceId: ws.id } });
    const trad = await testDb.variant.create({ data: { name: "Tradicional", itemId: item.id, workspaceId: ws.id } });

    const res = await createProductionBatch(fd({
      itemId: item.id,
      quantity: "10",
      producedAt: "2026-09-16",
      variantLines: JSON.stringify([{ variantId: choc.id, quantity: 6 }, { variantId: trad.id, quantity: 4 }]),
    }));
    expect(res.ok).toBe(true);

    const stock = await getItemStock();
    expect(stock.find((s) => s.variantId === choc.id)?.current).toBe(6);
    expect(stock.find((s) => s.variantId === trad.id)?.current).toBe(4);
  });
});

describe("deleteProductionBatch", () => {
  it("remove os StockMovement associados ao excluir o lote", async () => {
    const ws = await createWorkspace("Loja D");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Vela", workspaceId: ws.id, sellable: true, unit: "UN" } });
    await createProductionBatch(fd({ itemId: item.id, quantity: "10", producedAt: "2026-09-16" }));
    const batch = await testDb.productionBatch.findFirstOrThrow({ where: { itemId: item.id } });

    await deleteProductionBatch(batch.id);

    const stock = await getItemStock();
    expect(stock.find((s) => s.itemId === item.id)?.current).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run src/server/actions/production.test.ts
```

- [ ] **Step 3: Reescrever `src/server/actions/production.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import type { Prisma, PrismaClient } from "@prisma/client";

type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

type VariantLineInput = { variantId: string; quantity: number };

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

async function computeRecipeConsumption(
  tx: Tx,
  recipeId: string,
  quantity: number,
  variantLines: VariantLineInput[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const recipe = await tx.recipe.findUnique({ where: { id: recipeId }, include: { items: true } });
  if (!recipe) return map;
  const yieldQty = recipe.yieldQty || 1;
  const batchesCount = quantity / yieldQty;
  for (const ri of recipe.items) {
    map.set(ri.itemId, (map.get(ri.itemId) ?? 0) + ri.quantity * batchesCount);
  }

  for (const line of variantLines) {
    const variant = await tx.variant.findUnique({
      where: { id: line.variantId },
      include: { recipe: { include: { items: true } } },
    });
    if (!variant?.recipe) continue;
    for (const ri of variant.recipe.items) {
      map.set(ri.itemId, (map.get(ri.itemId) ?? 0) + ri.quantity * line.quantity);
    }
  }
  return map;
}

async function writeProductionMovements(
  tx: Tx,
  workspaceId: string,
  batchId: string,
  itemId: string,
  recipeId: string | null,
  quantity: number,
  variantLines: VariantLineInput[],
) {
  const activeLines = variantLines.filter((l) => l.variantId && l.quantity > 0);

  for (const line of activeLines) {
    await tx.productionVariantLine.create({
      data: { productionBatchId: batchId, variantId: line.variantId, quantity: line.quantity, workspaceId },
    });
    await tx.stockMovement.create({
      data: { itemId, variantId: line.variantId, type: "PRODUCTION", quantity: line.quantity, productionBatchId: batchId, workspaceId },
    });
  }
  if (activeLines.length === 0) {
    await tx.stockMovement.create({
      data: { itemId, type: "PRODUCTION", quantity, productionBatchId: batchId, workspaceId },
    });
  }

  if (recipeId) {
    const consumption = await computeRecipeConsumption(tx, recipeId, quantity, activeLines);
    for (const [consumedItemId, consumedQty] of consumption) {
      if (consumedQty <= 0) continue;
      await tx.stockMovement.create({
        data: { itemId: consumedItemId, type: "CONSUMPTION", quantity: -Math.round(consumedQty), productionBatchId: batchId, workspaceId },
      });
    }
  }
}

function parseForm(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "").trim();
  const recipeId = String(formData.get("recipeId") ?? "").trim() || null;
  const quantity = parseInt(String(formData.get("quantity") ?? "0"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const producedAtRaw = String(formData.get("producedAt") ?? "").trim();
  const producedAt = producedAtRaw ? new Date(`${producedAtRaw}T12:00:00`) : new Date();
  let variantLines: VariantLineInput[] = [];
  try { variantLines = JSON.parse(String(formData.get("variantLines") ?? "[]")); } catch { /* noop */ }
  return { itemId, recipeId, quantity, notes, producedAt, variantLines };
}

function validate(itemId: string, quantity: number, variantLines: VariantLineInput[]): string | null {
  if (!itemId) return "Selecione um item.";
  if (quantity <= 0) return "Quantidade deve ser maior que zero.";
  const total = variantLines.reduce((s, l) => s + l.quantity, 0);
  if (variantLines.length > 0 && total !== quantity) {
    return `Total distribuído (${total}) deve ser igual à quantidade produzida (${quantity}).`;
  }
  return null;
}

export async function createProductionBatch(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId, userId } = await getScopedDb();
  await assertCanWrite();

  const { itemId, recipeId, quantity, notes, producedAt, variantLines } = parseForm(formData);
  const error = validate(itemId, quantity, variantLines);
  if (error) return { ok: false, error };

  try {
    await db.$transaction(async (tx) => {
      const batch = await tx.productionBatch.create({
        data: { itemId, recipeId, userId, quantity, notes, producedAt, workspaceId },
      });
      await writeProductionMovements(tx, workspaceId, batch.id, itemId, recipeId, quantity, variantLines);
    });
    revalidatePath("/products");
    revalidatePath("/stock");
    return { ok: true };
  } catch (e) {
    console.error("createProductionBatch error:", e);
    return { ok: false, error: "Erro ao registrar produção." };
  }
}

export async function updateProductionBatch(id: string, formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb();
  await assertCanWrite();

  const { itemId, recipeId, quantity, notes, producedAt, variantLines } = parseForm(formData);
  const error = validate(itemId, quantity, variantLines);
  if (error) return { ok: false, error };

  try {
    await db.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { productionBatchId: id } });
      await tx.productionVariantLine.deleteMany({ where: { productionBatchId: id } });
      await tx.productionBatch.update({ where: { id }, data: { itemId, recipeId, quantity, notes, producedAt } });
      await writeProductionMovements(tx, workspaceId, id, itemId, recipeId, quantity, variantLines);
    });
    revalidatePath("/products");
    revalidatePath("/stock");
    return { ok: true };
  } catch (e) {
    console.error("updateProductionBatch error:", e);
    return { ok: false, error: "Erro ao atualizar produção." };
  }
}

export async function deleteProductionBatch(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  try {
    await db.$transaction([
      db.stockMovement.deleteMany({ where: { productionBatchId: id } }),
      db.productionVariantLine.deleteMany({ where: { productionBatchId: id } }),
      db.productionBatch.delete({ where: { id } }),
    ]);
    revalidatePath("/products");
    revalidatePath("/stock");
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
}
```

> `Tx` acima é uma tentativa de tipar o client de transação — se o padrão de tipagem usado em `src/server/actions/purchases.ts` para `db.$transaction(async (tx) => ...)` for diferente (ex.: `Prisma.TransactionClient` já exportado), prefira o tipo já usado no resto do código em vez de redefinir `Tx`.

- [ ] **Step 4: Rodar e confirmar sucesso**

```bash
pnpm vitest run src/server/actions/production.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/production.ts src/server/actions/production.test.ts
git commit -m "$(cat <<'EOF'
feat(producao): grava StockMovement(PRODUCTION/CONSUMPTION) na escrita do lote

Consumo de insumos de receita deixa de ser recalculado na leitura
(buildConsumptionMap) e passa a ser uma linha de ledger gravada uma vez,
no momento da produção.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Compras — `itemId` + StockMovement(PURCHASE) incondicional

**Files:**
- Modify: `src/server/actions/purchases.ts`
- Modify: `src/server/queries/purchases.ts`
- Modify: `src/server/queries/purchase-cost.ts`
- Modify: `src/server/actions/purchases.test.ts`
- Modify: `src/server/queries/purchase-cost.test.ts`

**Interfaces:**
- Consumes: `Item.unit` (Task 1), `toBaseUnit`/`InputUnit` de `@/lib/units` (sem mudança de assinatura).
- Produces: `createPurchase` grava `StockMovement(PURCHASE)` para **todo** item comprado (não só revenda); `unitCostFromLastPurchase(purchaseItem)` e `getLastPurchase(db, itemId, supplierId?)` com `itemId` no lugar de `ingredientId`.

- [ ] **Step 1: Adaptar os testes existentes**

Em `src/server/actions/purchases.test.ts` e `src/server/queries/purchase-cost.test.ts`: troque toda criação `testDb.ingredient.create(...)` por `testDb.item.create({ data: { ..., unit: "G", productionInput: true } })`, e todo campo `ingredientId` em `PurchaseItemInput`/asserts por `itemId`. O arquivo já usa o padrão `vi.mock("@/server/tenant/context", ...)` com objeto `context` mutável (mantenha esse boilerplate como está, só ajustando os dados de fixture) — chame as actions diretamente (`createPurchase(fd)`), sem nenhum wrapper. Remova qualquer teste que hoje verifica "só grava StockMovement se `forResale=true`" e substitua por uma asserção de que **toda** compra grava `StockMovement(PURCHASE)`, independente de `sellable`/`productionInput`:

```ts
it("grava StockMovement(PURCHASE) para qualquer item comprado, revenda ou não", async () => {
  const ws = await createWorkspace("Loja A");
  context.workspaceId = ws.id;
  const item = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, sellable: false } });

  const fd = new FormData();
  fd.set("items", JSON.stringify([{ itemId: item.id, quantity: 5, unit: "KG", pricePaidCents: 2000 }]));
  const res = await createPurchase(fd);
  expect(res.ok).toBe(true);

  const movement = await testDb.stockMovement.findFirstOrThrow({ where: { itemId: item.id, type: "PURCHASE" } });
  expect(movement.quantity).toBe(5000); // 5kg em gramas
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run src/server/actions/purchases.test.ts src/server/queries/purchase-cost.test.ts
```

- [ ] **Step 3: Reescrever `src/server/queries/purchase-cost.ts`**

```ts
import type { PrismaClient } from "@prisma/client";

type LastPurchase = { quantity: number; pricePaidCents: number } | null;

export function unitCostFromLastPurchase(last: LastPurchase): number | null {
  if (!last || last.quantity <= 0) return null;
  return last.pricePaidCents / last.quantity;
}

export async function getLastPurchase(
  db: PrismaClient,
  itemId: string,
  supplierId?: string,
) {
  return db.purchaseItem.findFirst({
    where: { itemId, ...(supplierId ? { purchase: { supplierId } } : {}) },
    orderBy: { purchase: { purchasedAt: "desc" } },
  });
}
```

(mesma lógica de hoje — só o parâmetro/campo `ingredientId`→`itemId`; confira o arquivo atual antes de reescrever para não perder nenhum detalhe de where/orderBy que eu possa ter simplificado aqui.)

- [ ] **Step 4: Atualizar `src/server/queries/purchases.ts`**

Troque qualquer `include: { ingredient: ... }` / seleção de `ingredient.baseUnit` por `item`/`item.unit`.

- [ ] **Step 5: Reescrever `src/server/actions/purchases.ts`**

```ts
type PurchaseItemInput = {
  itemId: string;
  quantity: number;
  unit: InputUnit;
  pricePaidCents: number;
};

export async function createPurchase(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId, userId } = await getScopedDb();
  await assertCanWrite();

  const supplierId = String(formData.get("supplierId") ?? "").trim() || null;
  const purchasedAtRaw = String(formData.get("purchasedAt") ?? "").trim();
  const purchasedAt = purchasedAtRaw ? new Date(`${purchasedAtRaw}T12:00:00`) : new Date();

  let items: PurchaseItemInput[];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]")) as PurchaseItemInput[];
  } catch {
    return { ok: false, error: "Itens inválidos." };
  }
  if (items.length === 0) return { ok: false, error: "Adicione ao menos um item." };
  for (const item of items) {
    if (!item.itemId) return { ok: false, error: "Selecione o item em todos os itens." };
    if (!item.quantity || item.quantity <= 0) return { ok: false, error: "Quantidade inválida em algum item." };
    if (!item.pricePaidCents || item.pricePaidCents <= 0) {
      return { ok: false, error: "Informe o preço pago em todos os itens." };
    }
  }

  const catalogItems = await db.item.findMany({
    where: { id: { in: items.map((i) => i.itemId) } },
    select: { id: true, unit: true },
  });
  const itemMap = new Map(catalogItems.map((i) => [i.id, i]));

  try {
    await db.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          supplierId,
          userId,
          purchasedAt,
          workspaceId,
          items: {
            create: items.map((line) => {
              const catalogItem = itemMap.get(line.itemId);
              const { quantity, unit } = toBaseUnit(line.quantity, line.unit, catalogItem?.unit);
              return { itemId: line.itemId, quantity, unit, pricePaidCents: line.pricePaidCents, workspaceId };
            }),
          },
        },
        include: { items: true },
      });

      for (const line of created.items) {
        await tx.stockMovement.create({
          data: { itemId: line.itemId, type: StockMovementType.PURCHASE, quantity: Math.round(line.quantity), purchaseId: created.id, workspaceId },
        });
      }
    });
  } catch {
    return { ok: false, error: "Não foi possível registrar a compra." };
  }

  revalidatePath("/purchases");
  revalidatePath("/stock");
  return { ok: true };
}

export async function deletePurchase(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  await db.stockMovement.deleteMany({ where: { purchaseId: id } });
  await db.purchase.delete({ where: { id } });
  revalidatePath("/purchases");
  revalidatePath("/stock");
  return { ok: true };
}

export async function fetchLastPriceForSupplierItem(
  supplierId: string | null,
  itemId: string,
): Promise<{ quantity: number; unit: BaseUnit; pricePaidCents: number } | null> {
  const { db } = await getScopedDb();
  const last = await getLastPurchase(db, itemId, supplierId ?? undefined);
  if (!last) return null;
  return { quantity: last.quantity, unit: last.unit, pricePaidCents: last.pricePaidCents };
}
```

(mantenha `createSupplierInline`/`updateSupplier`/`deleteSupplier` exatamente como estão — não tocam em `Item`.)

- [ ] **Step 6: Rodar e confirmar sucesso**

```bash
pnpm vitest run src/server/actions/purchases.test.ts src/server/queries/purchase-cost.test.ts src/server/queries/purchases.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/purchases.ts src/server/actions/purchases.test.ts src/server/queries/purchases.ts src/server/queries/purchase-cost.ts src/server/queries/purchase-cost.test.ts
git commit -m "$(cat <<'EOF'
feat(compras): StockMovement(PURCHASE) grava pra qualquer item, não só revenda

O caso especial "insumo marcado pra revenda" deixa de existir — era um hack
em cima de Ingredient+Product pareados que a unificação em Item elimina.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Cadastro de Item (substitui `ingredients.ts` query+action)

**Files:**
- Create: `src/server/actions/items.ts` (substitui `src/server/actions/ingredients.ts`)
- Create: `src/server/queries/items.ts` (substitui `src/server/queries/ingredients.ts`)
- Delete: `src/server/actions/ingredients.ts`, `src/server/queries/ingredients.ts`
- Modify: `src/server/actions/ingredients.test.ts` → renomeie para `src/server/actions/items.test.ts`

**Interfaces:**
- Produces: `createItem`, `updateItem`, `deleteItem`, `createItemForPurchase` (`FormData` → `ActionResult`, com campos `name`, `unit`, `minStock`, `productionInput`, `sellable`); `getItemsWithLastCost()`.
- Consumidor: Task 13 (componentes `item-dialog.tsx`, combobox de compras/receitas).

- [ ] **Step 1: Adaptar o teste (falhando)**

Renomeie `src/server/actions/ingredients.test.ts` para `src/server/actions/items.test.ts`, trocando cada `createIngredient`/`updateIngredient`/`createIngredientForPurchase` por `createItem`/`updateItem`/`createItemForPurchase`, cada campo de formulário `isRawMaterial`/`forResale`/`baseUnit` por `productionInput`/`sellable`/`unit`, e removendo qualquer asserção que hoje checa a criação do `Product` pareado (`syncResaleProduct` não existe mais — `sellable=true` já é só uma flag no próprio `Item`, sem linha extra). Mantenha o boilerplate `vi.mock("@/server/tenant/context", ...)` já existente no arquivo (mesmo padrão de `context.workspaceId`/`context.canWrite` usado em `purchases.test.ts`), chamando as actions diretamente. Adicione um teste cobrindo o caso que antes exigia duas tabelas:

```ts
it("permite marcar productionInput e sellable ao mesmo tempo no mesmo item", async () => {
  const ws = await createWorkspace("Loja A");
  context.workspaceId = ws.id;
  const fd = new FormData();
  fd.set("name", "Açúcar embalado");
  fd.set("unit", "UN");
  fd.set("productionInput", "on");
  fd.set("sellable", "on");

  const res = await createItem(fd);
  expect(res.ok).toBe(true);

  const item = await testDb.item.findFirstOrThrow({ where: { name: "Açúcar embalado" } });
  expect(item.productionInput).toBe(true);
  expect(item.sellable).toBe(true);
});

it("rejeita sellable com unidade diferente de UN", async () => {
  const ws = await createWorkspace("Loja B");
  context.workspaceId = ws.id;
  const fd = new FormData();
  fd.set("name", "Farinha a granel");
  fd.set("unit", "G");
  fd.set("sellable", "on");

  const res = await createItem(fd);
  expect(res.ok).toBe(false);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run src/server/actions/items.test.ts
```

- [ ] **Step 3: Criar `src/server/actions/items.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { normalizeName } from "@/lib/text";
import { BaseUnit } from "@prisma/client";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function parseUnit(value: string): BaseUnit {
  if (value === "ML") return BaseUnit.ML;
  if (value === "UN") return BaseUnit.UN;
  return BaseUnit.G;
}

function parseRoleFlags(formData: FormData): { productionInput: boolean; sellable: boolean } {
  return {
    productionInput: formData.get("productionInput") === "on",
    sellable: formData.get("sellable") === "on",
  };
}

function validateRoles(productionInput: boolean, sellable: boolean, unit: BaseUnit): string | null {
  if (!productionInput && !sellable) return "Marque insumo de produção e/ou venda.";
  if (sellable && unit !== BaseUnit.UN) return "Venda só é permitida para itens com unidade \"Unidade (un)\".";
  return null;
}

export async function createItem(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const unit = parseUnit(String(formData.get("unit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;
  const { productionInput, sellable } = parseRoleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };
  const roleError = validateRoles(productionInput, sellable, unit);
  if (roleError) return { ok: false, error: roleError };

  try {
    await db.item.create({ data: { name, unit, minStock, productionInput, sellable, workspaceId } });
  } catch {
    return { ok: false, error: "Já existe um item com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function updateItem(id: string, formData: FormData): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const unit = parseUnit(String(formData.get("unit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;
  const { productionInput, sellable } = parseRoleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };
  const roleError = validateRoles(productionInput, sellable, unit);
  if (roleError) return { ok: false, error: roleError };

  try {
    await db.item.update({ where: { id }, data: { name, unit, minStock, productionInput, sellable } });
  } catch {
    return { ok: false, error: "Já existe um item com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function deleteItem(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  try {
    await db.item.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir. O item pode estar em uso." };
  }
  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export type ItemInlineData = {
  id: string;
  name: string;
  unit: BaseUnit;
  productionInput: boolean;
  sellable: boolean;
};

export async function createItemForPurchase(
  formData: FormData,
): Promise<ActionResult<ItemInlineData>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const unit = parseUnit(String(formData.get("unit") ?? "G"));
  const { productionInput, sellable } = parseRoleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  const roleError = validateRoles(productionInput, sellable, unit);
  if (roleError) return { ok: false, error: roleError };

  try {
    const item = await db.item.create({ data: { name, unit, productionInput, sellable, workspaceId } });
    revalidatePath("/admin/ingredients");
    return { ok: true, data: { id: item.id, name: item.name, unit: item.unit, productionInput, sellable } };
  } catch {
    return { ok: false, error: "Já existe um item com esse nome." };
  }
}
```

- [ ] **Step 4: Criar `src/server/queries/items.ts`**

```ts
import { getWorkspaceDb } from "@/server/tenant/context";
import { unitCostFromLastPurchase } from "./purchase-cost";

export type ItemWithCost = Awaited<ReturnType<typeof getItemsWithLastCost>>[number];

export async function getItemsWithLastCost() {
  const db = await getWorkspaceDb();
  const items = await db.item.findMany({
    orderBy: { name: "asc" },
    include: {
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        select: { quantity: true, pricePaidCents: true },
      },
    },
  });

  return items.map((item) => {
    const last = item.purchaseItems[0] ?? null;
    const unitCostCents = unitCostFromLastPurchase(last);
    const { purchaseItems, ...rest } = item;
    return { ...rest, lastPurchase: last, unitCostCents };
  });
}
```

- [ ] **Step 5: Apagar os arquivos antigos**

```bash
git rm src/server/actions/ingredients.ts src/server/queries/ingredients.ts
```

- [ ] **Step 6: Rodar e confirmar sucesso**

```bash
pnpm vitest run src/server/actions/items.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/items.ts src/server/queries/items.ts src/server/actions/items.test.ts
git commit -m "$(cat <<'EOF'
feat(itens): ingredients.ts vira items.ts, sem o hack de Product pareado

createItem/updateItem escrevem direto sellable/productionInput no Item —
syncResaleProduct (que criava um Product-sombra) não existe mais.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Receitas — `RecipeItem` no lugar de `RecipeIngredient`

**Files:**
- Modify: `src/server/actions/recipes.ts`
- Modify: `src/server/queries/recipes.ts`
- Test: adapte os testes existentes de receitas se houver (confira `src/server/actions/recipes.test.ts`/`src/server/queries/recipes.test.ts` — se não existirem, crie um teste mínimo cobrindo `saveRecipe` e `getRecipesWithCost`)

**Interfaces:**
- Consumes: `Item` (Task 1).
- Produces: `saveRecipe`, `deleteRecipe`, `createItemInline` (renomeado de `createIngredientInline`, cria `Item` com `productionInput: true`); `getRecipesWithCost`, `getRecipeById`, `getItemOptions` (renomeado de `getIngredientOptions`).

- [ ] **Step 1: Reescrever `src/server/actions/recipes.ts`**

Troque `IngredientLine`→`ItemLine` (`{ itemId, quantity }`), `db.recipeIngredient`→`db.recipeItem`, campo `ingredientId`→`itemId` nos `createMany`/`create` aninhados, e `createIngredientInline`→`createItemInline`:

```ts
type ItemLine = { itemId: string; quantity: number };

// ... em saveRecipe, troque:
db.recipeItem.deleteMany({ where: { recipeId: id } }),
...(items.length > 0
  ? [db.recipeItem.createMany({
      data: items.map((it) => ({ recipeId: id, itemId: it.itemId, quantity: it.quantity, workspaceId })),
    })]
  : []),

// e no create:
items: {
  create: items.map((it) => ({ itemId: it.itemId, quantity: it.quantity, workspaceId })),
},

// ...

type ItemData = { id: string; name: string; unit: string };

export async function createItemInline(formData: FormData): Promise<ActionResult<ItemData>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = String(formData.get("name") ?? "").trim();
  const unitRaw = String(formData.get("unit") ?? "G");
  const unit = unitRaw === "ML" ? BaseUnit.ML : unitRaw === "UN" ? BaseUnit.UN : BaseUnit.G;

  if (!name) return { ok: false, error: "Nome obrigatório." };

  try {
    const item = await db.item.create({ data: { name, unit, productionInput: true, workspaceId } });
    revalidatePath("/admin/ingredients");
    return { ok: true, data: { id: item.id, name: item.name, unit: item.unit } };
  } catch {
    return { ok: false, error: "Já existe um item com esse nome." };
  }
}
```

(a variável local recebida do form em `saveRecipe` também precisa ser renomeada de `ingredients` para `items` em todo o corpo da função — troque as duas ocorrências de `formData.get("ingredients")`/`ingredientsRaw` para `formData.get("items")`/`itemsRaw` também, mantendo consistência com o novo nome de campo.)

- [ ] **Step 2: Reescrever `src/server/queries/recipes.ts`**

Troque `recipe.ingredients`→`recipe.items`, `ri.ingredient`→`ri.item`, `ri.ingredientId`→`ri.itemId`, `getIngredientOptions`→`getItemOptions` filtrando por `productionInput: true`:

```ts
export async function getRecipesWithCost() {
  const db = await getWorkspaceDb();
  const recipes = await db.recipe.findMany({
    orderBy: { name: "asc" },
    include: {
      items: {
        include: {
          item: {
            include: {
              purchaseItems: { orderBy: { purchase: { purchasedAt: "desc" } }, take: 1, select: { quantity: true, pricePaidCents: true } },
            },
          },
        },
      },
    },
  });

  return recipes.map((recipe) => {
    let totalCostCents = 0;
    let hasAllCosts = recipe.items.length > 0;
    for (const ri of recipe.items) {
      const lastPurchase = ri.item.purchaseItems[0] ?? null;
      const unitCost = unitCostFromLastPurchase(lastPurchase);
      if (unitCost === null) { hasAllCosts = false; continue; }
      totalCostCents += unitCost * ri.quantity;
    }
    return {
      id: recipe.id, name: recipe.name, yieldQty: recipe.yieldQty, notes: recipe.notes,
      ingredientCount: recipe.items.length,
      totalCostCents: hasAllCosts ? totalCostCents : null,
      costPerUnitCents: hasAllCosts && recipe.yieldQty > 0 ? totalCostCents / recipe.yieldQty : null,
    };
  });
}

export async function getRecipeById(id: string) {
  const db = await getWorkspaceDb();
  const recipe = await db.recipe.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          item: {
            include: { purchaseItems: { orderBy: { purchase: { purchasedAt: "desc" } }, take: 1, select: { quantity: true, pricePaidCents: true } } },
          },
        },
        orderBy: { item: { name: "asc" } },
      },
    },
  });
  if (!recipe) return null;
  return {
    ...recipe,
    ingredients: recipe.items.map((ri) => ({
      itemId: ri.itemId,
      itemName: ri.item.name,
      unit: ri.item.unit,
      quantity: ri.quantity,
      unitCostCents: unitCostFromLastPurchase(ri.item.purchaseItems[0] ?? null),
    })),
  };
}

export type ItemOption = Awaited<ReturnType<typeof getItemOptions>>[number];

export async function getItemOptions() {
  const db = await getWorkspaceDb();
  const items = await db.item.findMany({
    where: { productionInput: true },
    orderBy: { name: "asc" },
    include: { purchaseItems: { orderBy: { purchase: { purchasedAt: "desc" } }, take: 1, select: { quantity: true, pricePaidCents: true } } },
  });
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit as string,
    unitCostCents: unitCostFromLastPurchase(item.purchaseItems[0] ?? null),
  }));
}
```

(mantive o campo de retorno `ingredients`/`ingredientCount` no shape público de `getRecipeById`/`getRecipesWithCost` para não obrigar renomear os componentes de receita nesta task — isso é só o formato de saída da query, já cobrindo o rename interno de `RecipeIngredient`→`RecipeItem`; a Task 13 decide se vale a pena renomear esses campos de saída também ao atualizar `recipe-form.tsx`.)

- [ ] **Step 3: Rodar a suíte de receitas (se existir) e o typecheck**

```bash
pnpm vitest run src/server/actions/recipes.test.ts src/server/queries/recipes.test.ts 2>/dev/null || true
pnpm tsc --noEmit -p . 2>&1 | grep -i recipe
```

- [ ] **Step 4: Commit**

```bash
git add src/server/actions/recipes.ts src/server/queries/recipes.ts
git commit -m "$(cat <<'EOF'
refactor(receitas): RecipeIngredient vira RecipeItem, aponta pra Item

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Catálogo — `Item`/`Variant` no lugar de `Product`/`Flavor`

**Files:**
- Modify: `src/server/queries/catalog.ts`
- Modify: `src/server/actions/catalog.ts`

**Interfaces:**
- Produces: `getItemsWithVariantsAndPrices` (ex-`getProductsWithFlavorsAndPrices`), `getItemForEdit` (ex-`getProductForEdit`), `getCatalogOverview`, `saveItem` (ex-`saveProduct`), `toggleItemActive`/`toggleVariantActive`/`togglePriceActive`.

- [ ] **Step 1: Reescrever `src/server/queries/catalog.ts`**

Troque `db.product`→`db.item`, `flavors`→`variants`, `flavorId`→`variantId`, `fillingRecipeId`→`recipeId`, e nos nomes exportados: `getProductsWithFlavorsAndPrices`→`getItemsWithVariantsAndPrices`, `getProductForEdit`→`getItemForEdit`. Ao criar um item novo em `getItemForEdit`, inclua `sellable: true` no filtro/seleção não é necessário (a query só lê); mantenha a mesma estrutura de include, só trocando os nomes de relation (`item.variants` em vez de `product.flavors`).

- [ ] **Step 2: Reescrever `src/server/actions/catalog.ts`**

Troque `toggleProductActive`→`toggleItemActive` (`db.item.update`), `toggleFlavorActive`→`toggleVariantActive` (`db.variant.update`), `saveProduct`→`saveItem` com `ProductFlavorInput`→`ItemVariantInput` (`fillingRecipeId`→`recipeId`), `SaveProductInput`→`SaveItemInput` (`flavors`→`variants`, `removedFlavorIds`→`removedVariantIds`). Na criação de um item novo (`db.item.create`), adicione `sellable: true` explicitamente:

```ts
const item = itemId
  ? await db.item.update({ where: { id: itemId }, data: { name } })
  : await db.item.create({ data: { name, sellable: true, workspaceId } });
```

Troque `db.flavor.update`/`db.flavor.create`/`db.flavor.delete` por `db.variant.*`, `productId: product.id`→`itemId: item.id`, `db.saleItem.count({ where: { flavorId } })`→`{ where: { variantId } }`, `db.productionBatch.count({ where: { flavorId } })`→`{ where: { variantId } }`.

- [ ] **Step 3: Typecheck**

```bash
pnpm tsc --noEmit -p . 2>&1 | grep -iE "catalog|saveProduct|saveItem"
```

(erros nos componentes que ainda chamam `saveProduct`/`getProductsWithFlavorsAndPrices` são esperados até a Task 13 — confira só que `catalog.ts`/`catalog.ts` (query) em si não têm mais erro de tipo internos.)

- [ ] **Step 4: Commit**

```bash
git add src/server/queries/catalog.ts src/server/actions/catalog.ts
git commit -m "$(cat <<'EOF'
refactor(catalogo): Product/Flavor viram Item/Variant no server layer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Dashboard e Vendas — renomeações mecânicas de FK

**Files:**
- Modify: `src/server/queries/dashboard.ts`
- Modify: `src/server/queries/dashboard.test.ts`
- Modify: `src/server/queries/sales.ts`
- Modify: `src/server/actions/sales.ts`
- Modify: `src/server/actions/sales-write-lock.test.ts`

**Interfaces:**
- Consumes: `Item`/`Variant` (Task 1), `getItemStock` (Task 3, substitui o cálculo de alerta de despensa que hoje vive dentro de `dashboard.ts`).
- Produces: mesma API pública de `getFilterOptions`/`getDashboardData`/`getSales`/`getSalesSummary`/etc — só os campos internos (`productId`→`itemId`, `flavorId`→`variantId`) mudam de nome.

- [ ] **Step 1: `src/server/queries/dashboard.ts`**

Esse arquivo é o maior (471 linhas) e o único com lógica de negócio própria além de renomear campos: a parte de "alerta de despensa" hoje reimplementa uma versão do cálculo de estoque de insumo (ver a inventory report: usa `Ingredient`, `forResale`, `resaleProductId`, `RecipeIngredient` diretamente). Troque essa parte para **chamar `getItemStock()`** (Task 3) e filtrar `belowMin` + `productionInput`, em vez de reimplementar a soma. Para o resto (mix de vendas, filtros por produto/sabor, COGS), troque mecanicamente: `Ingredient`/`Flavor`→`Item`/`Variant`, `productId`→`itemId`, `flavorId`→`variantId`, `forResale`/`resaleProductId`→ (já não existe distinção: qualquer `Item` com `sellable=true` e `StockMovement(PURCHASE)` própria segue o caminho de custo "última compra direta"; o `if (product.id === ingredient.resaleProductId)` vira `if (item.sellable && hasDirectPurchase(item.id))`, sem precisar de join com uma segunda tabela).

Leia o arquivo inteiro antes de editar (471 linhas é grande demais para reproduzir aqui por completo) e aplique essas trocas seção por seção, rodando `pnpm tsc --noEmit` a cada seção para pegar os call-sites que sobraram.

- [ ] **Step 2: Adaptar `src/server/queries/dashboard.test.ts`**

Troque toda fixture `testDb.ingredient.create`/`testDb.product.create` por `testDb.item.create` (com `productionInput`/`sellable` conforme o papel), `RecipeIngredient`→`RecipeItem`, `ingredientId`→`itemId`.

- [ ] **Step 3: `src/server/queries/sales.ts` e `src/server/actions/sales.ts`**

Troque `db.product.findMany`→`db.item.findMany` (com `where: { sellable: true }` explicitamente, já que nem todo `Item` é vendável agora), `productId`→`itemId`, `flavorId`→`variantId` em todas as queries/mutations. `StockMovementType.SALE` continua igual.

- [ ] **Step 4: `src/server/actions/sales-write-lock.test.ts`**

Troque os campos de fixture `productId`/`flavorId` por `itemId`/`variantId`.

- [ ] **Step 5: Rodar os testes**

```bash
pnpm vitest run src/server/queries/dashboard.test.ts src/server/actions/sales-write-lock.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/server/queries/dashboard.ts src/server/queries/dashboard.test.ts src/server/queries/sales.ts src/server/actions/sales.ts src/server/actions/sales-write-lock.test.ts
git commit -m "$(cat <<'EOF'
refactor(dashboard,vendas): productId/flavorId viram itemId/variantId

Alerta de estoque baixo no dashboard passa a reusar getItemStock() em vez
de reimplementar o cálculo de saldo de insumo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Lista de compras — CRUD livre + sugestões opt-in + registrar compra

**Files:**
- Modify: `src/server/queries/shopping-list.ts`
- Modify: `src/server/actions/shopping-list.ts`
- Modify: `src/server/actions/shopping-list.test.ts`

**Interfaces:**
- Consumes: `getItemStock` (Task 3).
- Produces: `getShoppingListItems()` (mantém), `getShoppingListSuggestions()` (novo — itens `belowMin` que ainda não estão na lista), `createShoppingListItem(formData)` (novo), `updateShoppingListItem(id, formData)` (novo), `deleteShoppingListItem(id)` (novo), `toggleShoppingListItem(id, done)` (mantém assinatura), `addSuggestedItem(itemId)` (novo — cria uma linha a partir de uma sugestão). Remove `generateAutoShoppingList`.

- [ ] **Step 1: Escrever os testes (falhando)**

Reescreva `src/server/actions/shopping-list.test.ts`, mantendo o mesmo padrão `vi.mock("@/server/tenant/context", ...)` com objeto `context` mutável que o arquivo já usa hoje (mock de `getScopedDb`/`getWorkspaceDb`/`assertCanWrite`, igual ao de `purchases.test.ts`), e chamando as actions/queries diretamente (sem wrapper):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "", canWrite: true };

vi.mock("@/server/tenant/context", () => ({
  getScopedDb: async () => ({
    db: scopedDb(context.workspaceId),
    workspaceId: context.workspaceId,
    userId: context.userId,
    role: "OWNER",
    canWrite: context.canWrite,
  }),
  getWorkspaceDb: async () => scopedDb(context.workspaceId),
  assertCanWrite: async () => {
    if (!context.canWrite) throw new Error("Este workspace está em modo somente leitura.");
  },
}));

const { createShoppingListItem, deleteShoppingListItem, toggleShoppingListItem, addSuggestedItem } = await import("./shopping-list");
const { getShoppingListItems, getShoppingListSuggestions } = await import("@/server/queries/shopping-list");

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(async () => {
  await resetDb();
  context.canWrite = true;
});

describe("createShoppingListItem", () => {
  it("cria um item de texto livre, sem vínculo com Item cadastrado", async () => {
    const ws = await createWorkspace("Loja A");
    context.workspaceId = ws.id;
    const res = await createShoppingListItem(fd({ label: "Café de casa" }));
    expect(res.ok).toBe(true);

    const items = await getShoppingListItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: "Café de casa", itemId: null });
  });

  it("cria um item vinculado a um Item cadastrado, com quantidade/unidade", async () => {
    const ws = await createWorkspace("Loja B");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Açúcar", workspaceId: ws.id, unit: "G", productionInput: true } });

    const res = await createShoppingListItem(fd({ itemId: item.id, label: "Açúcar", quantity: "500", unit: "G" }));
    expect(res.ok).toBe(true);

    const items = await getShoppingListItems();
    expect(items[0]).toMatchObject({ itemId: item.id, quantity: 500, unit: "G" });
  });
});

describe("getShoppingListSuggestions", () => {
  it("sugere itens abaixo do mínimo que ainda não estão na lista", async () => {
    const ws = await createWorkspace("Loja C");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, minStock: 1000 } });
    await testDb.stockMovement.create({ data: { itemId: item.id, type: "PURCHASE", quantity: 200, workspaceId: ws.id } });

    const suggestions = await getShoppingListSuggestions();
    expect(suggestions.map((s) => s.itemId)).toContain(item.id);
  });

  it("não sugere um item que já está na lista (pendente)", async () => {
    const ws = await createWorkspace("Loja D");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, minStock: 1000 } });
    await testDb.stockMovement.create({ data: { itemId: item.id, type: "PURCHASE", quantity: 200, workspaceId: ws.id } });
    await createShoppingListItem(fd({ itemId: item.id, label: "Farinha" }));

    const suggestions = await getShoppingListSuggestions();
    expect(suggestions.map((s) => s.itemId)).not.toContain(item.id);
  });
});

describe("addSuggestedItem", () => {
  it("cria a linha da lista a partir de uma sugestão, com o déficit como quantidade", async () => {
    const ws = await createWorkspace("Loja E");
    context.workspaceId = ws.id;
    const item = await testDb.item.create({ data: { name: "Farinha", workspaceId: ws.id, unit: "G", productionInput: true, minStock: 1000 } });
    await testDb.stockMovement.create({ data: { itemId: item.id, type: "PURCHASE", quantity: 200, workspaceId: ws.id } });

    const res = await addSuggestedItem(item.id);
    expect(res.ok).toBe(true);

    const items = await getShoppingListItems();
    expect(items[0]).toMatchObject({ itemId: item.id, quantity: 800 });
  });
});

describe("deleteShoppingListItem / toggleShoppingListItem", () => {
  it("apaga um item da lista", async () => {
    const ws = await createWorkspace("Loja F");
    context.workspaceId = ws.id;
    await createShoppingListItem(fd({ label: "Guardanapo" }));
    const [item] = await getShoppingListItems();

    await deleteShoppingListItem(item.id);
    expect(await getShoppingListItems()).toHaveLength(0);
  });

  it("marcar como comprado tira o item da listagem de pendentes", async () => {
    const ws = await createWorkspace("Loja G");
    context.workspaceId = ws.id;
    await createShoppingListItem(fd({ label: "Guardanapo" }));
    const [item] = await getShoppingListItems();

    await toggleShoppingListItem(item.id, true);
    expect(await getShoppingListItems()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm vitest run src/server/actions/shopping-list.test.ts
```

- [ ] **Step 3: Reescrever `src/server/queries/shopping-list.ts`**

```ts
import { getWorkspaceDb } from "@/server/tenant/context";
import { getItemStock } from "./production";

export type ShoppingListEntry = {
  id: string;
  itemId: string | null;
  label: string;
  quantity: number | null;
  unit: string | null;
};

export async function getShoppingListItems(): Promise<ShoppingListEntry[]> {
  const db = await getWorkspaceDb();
  const items = await db.shoppingListItem.findMany({
    where: { done: false },
    orderBy: { createdAt: "asc" },
  });
  return items.map((i) => ({ id: i.id, itemId: i.itemId, label: i.label, quantity: i.quantity, unit: i.unit }));
}

export type ShoppingListSuggestion = {
  itemId: string;
  itemName: string;
  unit: string;
  deficit: number;
  estimatedCents: number | null;
};

export async function getShoppingListSuggestions(): Promise<ShoppingListSuggestion[]> {
  const db = await getWorkspaceDb();
  const stock = await getItemStock();
  const pending = await db.shoppingListItem.findMany({ where: { done: false, itemId: { not: null } }, select: { itemId: true } });
  const pendingIds = new Set(pending.map((p) => p.itemId));

  return stock
    .filter((s) => s.belowMin && s.minStock != null && !pendingIds.has(s.itemId))
    .map((s) => {
      const deficit = Math.max(0, (s.minStock ?? 0) - s.current);
      const estimatedCents = s.latestPriceCents != null ? Math.round(deficit * s.latestPriceCents) : null;
      return { itemId: s.itemId, itemName: s.itemName, unit: s.unit, deficit, estimatedCents };
    });
}
```

- [ ] **Step 4: Reescrever `src/server/actions/shopping-list.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { BaseUnit } from "@prisma/client";
import { getScopedDb, assertCanWrite } from "@/server/tenant/context";
import { getShoppingListSuggestions } from "@/server/queries/shopping-list";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Algo deu errado.";
}

export async function createShoppingListItem(formData: FormData): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();

    const itemId = String(formData.get("itemId") ?? "").trim() || null;
    const label = String(formData.get("label") ?? "").trim();
    const quantityRaw = String(formData.get("quantity") ?? "").trim();
    const quantity = quantityRaw ? parseFloat(quantityRaw.replace(",", ".")) : null;
    const unitRaw = String(formData.get("unit") ?? "").trim();
    const unit = unitRaw ? (unitRaw as BaseUnit) : null;

    if (!label) return { ok: false, error: "Descreva o item." };

    await db.shoppingListItem.create({ data: { workspaceId, itemId, label, quantity, unit } });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function updateShoppingListItem(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();

    const label = String(formData.get("label") ?? "").trim();
    const quantityRaw = String(formData.get("quantity") ?? "").trim();
    const quantity = quantityRaw ? parseFloat(quantityRaw.replace(",", ".")) : null;
    const unitRaw = String(formData.get("unit") ?? "").trim();
    const unit = unitRaw ? (unitRaw as BaseUnit) : null;

    if (!label) return { ok: false, error: "Descreva o item." };

    await db.shoppingListItem.updateMany({ where: { id, workspaceId }, data: { label, quantity, unit } });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function deleteShoppingListItem(id: string): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();
    await db.shoppingListItem.deleteMany({ where: { id, workspaceId } });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function toggleShoppingListItem(id: string, done: boolean): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();
    await db.shoppingListItem.updateMany({ where: { id, workspaceId }, data: { done } });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function addSuggestedItem(itemId: string): Promise<ActionResult> {
  try {
    const { db, workspaceId } = await getScopedDb();
    await assertCanWrite();

    const suggestions = await getShoppingListSuggestions();
    const suggestion = suggestions.find((s) => s.itemId === itemId);
    if (!suggestion) return { ok: false, error: "Sugestão não encontrada." };

    await db.shoppingListItem.create({
      data: {
        workspaceId,
        itemId: suggestion.itemId,
        label: suggestion.itemName,
        quantity: suggestion.deficit,
        unit: suggestion.unit as BaseUnit,
      },
    });
    revalidatePath("/stock/shopping-list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

```bash
pnpm vitest run src/server/actions/shopping-list.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/server/queries/shopping-list.ts src/server/actions/shopping-list.ts src/server/actions/shopping-list.test.ts
git commit -m "$(cat <<'EOF'
feat(lista-de-compras): CRUD livre + sugestões opt-in, fim da geração automática

generateAutoShoppingList (que criava itens silenciosamente) sai; entra
createShoppingListItem/updateShoppingListItem/deleteShoppingListItem +
getShoppingListSuggestions/addSuggestedItem, um clique explícito por sugestão.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Seed

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Reescrever para o modelo Item/Variant**

```ts
// Item base (vendável)
const cookie = await db.item.upsert({
  where: { workspaceId_name: { workspaceId: workspace.id, name: "Cookie" } },
  update: {},
  create: { name: "Cookie", sellable: true, unit: "UN", workspaceId: workspace.id },
});

const variants = ["Chocolate", "Red Velvet", "Tradicional"];
for (const name of variants) {
  const variant = await db.variant.upsert({
    where: { itemId_name: { itemId: cookie.id, name } },
    update: {},
    create: { name, itemId: cookie.id, workspaceId: workspace.id },
  });
  await db.priceListItem.upsert({
    where: { itemId_variantId: { itemId: cookie.id, variantId: variant.id } },
    update: {},
    create: { itemId: cookie.id, variantId: variant.id, priceCents: 800, workspaceId: workspace.id },
  });
}

// Itens de insumo de produção
const rawItems: Array<[string, "G" | "ML" | "UN"]> = [
  ["Açúcar", "G"],
  ["Farinha de trigo", "G"],
  ["Manteiga", "G"],
  ["Chocolate (insumo)", "G"],
  ["Ovo", "UN"],
];
for (const [name, unit] of rawItems) {
  await db.item.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name } },
    update: {},
    create: { name, unit, productionInput: true, sellable: false, minStock: 0, workspaceId: workspace.id },
  });
}
```

(renomeei o insumo "Chocolate" para "Chocolate (insumo)" no seed — o nome original colidiria com o nome do `Item` "Chocolate" se algum dia esse produto existisse; hoje não colide porque o produto se chama "Cookie" e a variante "Chocolate", mas a unicidade de nome agora é uma só (`Item.workspaceId_name`) para todo o namespace, então vale já semear sem ambiguidade.)

- [ ] **Step 2: Rodar o seed contra o banco de dev**

```bash
pnpm prisma db seed
```

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "$(cat <<'EOF'
chore(seed): adapta seed pro modelo Item/Variant unificado

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Páginas — `/pantry` → `/stock`, `/products` sem tab de estoque, admin

**Files:**
- Create: `src/app/(app)/stock/page.tsx` (substitui `src/app/(app)/pantry/page.tsx`)
- Delete: `src/app/(app)/pantry/page.tsx`
- Modify: `src/app/(app)/products/page.tsx`
- Modify: `src/app/(app)/products/new/page.tsx`, `src/app/(app)/products/[id]/edit/page.tsx`
- Modify: `src/app/(app)/purchases/page.tsx`
- Modify: `src/app/(app)/admin/ingredients/page.tsx`
- Modify: `src/app/(app)/admin/catalog/page.tsx`
- Modify: `src/app/(app)/admin/recipes/new/page.tsx`, `src/app/(app)/admin/recipes/[id]/edit/page.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/(app)/sales/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `getItemStock` (Task 3), `getItemsWithLastCost`/`getItemOptions` (Tasks 6–7).

- [ ] **Step 1: Criar `src/app/(app)/stock/page.tsx`**

Baseado no `src/app/(app)/pantry/page.tsx` atual, trocando `getPantryStock`→`getItemStock`, título "Despensa"→"Estoque", `entry.ingredientId`→`${entry.itemId}-${entry.variantId ?? ""}` (chave da lista), `entry.ingredientName`→`entry.itemName` (concatenando `entry.variantName` quando existir, ex.: `"Cookie — Chocolate"`), removendo o badge "Revenda" antigo (não existe mais como flag separada — `entry.sellable`/`entry.productionInput` substituem, mostre um badge "Venda" quando `sellable` e "Insumo" quando `productionInput`), e trocando o link do header para `/stock/shopping-list`.

- [ ] **Step 2: Apagar `src/app/(app)/pantry/page.tsx` e criar `src/app/(app)/stock/shopping-list/page.tsx`**

A Task 13 cobre o conteúdo novo da página de lista de compras (ela muda de comportamento, não só de rota) — nesta task só mova o arquivo de `pantry/shopping-list` para `stock/shopping-list` e ajuste os imports de rota (`backHref="/pantry"` → `backHref="/stock"`); o conteúdo em si é reescrito na Task 13.

```bash
git mv "src/app/(app)/pantry/shopping-list/page.tsx" "src/app/(app)/stock/shopping-list/page.tsx"
git rm "src/app/(app)/pantry/page.tsx"
```

- [ ] **Step 3: `src/app/(app)/products/page.tsx` — remover a tab "Estoque"**

Remova a `Tabs`/`TabsList`/`TabsContent value="stock"` inteira (o saldo de produto acabado agora vive em `/stock`) e deixe só a listagem de produções (o antigo `TabsContent value="history"`), com o título "Produtos"→"Produção" e a descrição "Histórico de produções". Troque `getCookieStock`→(remova a chamada), `b.product.name`→`b.item.name`, `b.fillings`→`b.variantLines`, `f.flavor.name`→`f.variant.name`.

- [ ] **Step 4: `src/app/(app)/products/new/page.tsx` e `.../products/[id]/edit/page.tsx`**

Troque `productId`→`itemId`, `flavorId`→`variantId` nos campos lidos/passados ao `ProductionForm` (a Task 13 reescreve o componente em si).

- [ ] **Step 5: `src/app/(app)/purchases/page.tsx`**

Troque a seleção de opções de item comprável: em vez de filtrar `Ingredient.baseUnit`/`forResale`, use `db.item.findMany` (via a query já existente em `getItemsWithLastCost` ou uma nova leve, à sua escolha) com `unit`/`sellable`.

- [ ] **Step 6: `src/app/(app)/admin/ingredients/page.tsx`**

Troque `getIngredientsWithLastCost`→`getItemsWithLastCost`, `ing.baseUnit`→`item.unit`, `ing.forResale`→`item.sellable` (badge "Venda" em vez de "Revenda"), `ing.isRawMaterial`→`item.productionInput`, componente `IngredientDialog`→`ItemDialog` (Task 13), `DeleteIngredientButton`→`DeleteItemButton` (Task 13). Título "Ingredientes"→"Insumos", descrição "Itens usados nas receitas ou comprados para revenda."

- [ ] **Step 7: `src/app/(app)/admin/catalog/page.tsx`**

Troque `activeFlavors`/`Flavor`→`activeVariants`/`Variant` nas contagens exibidas.

- [ ] **Step 8: `src/app/(app)/admin/recipes/new/page.tsx` e `.../[id]/edit/page.tsx`**

Troque `getIngredientOptions`→`getItemOptions`.

- [ ] **Step 9: `src/app/(app)/dashboard/page.tsx`**

Troque `productId`/`flavorId` (search params) por `itemId`/`variantId`, e os campos de estoque baixo (`baseUnit`/`minStock`) para os equivalentes vindos de `getItemStock` (via `getDashboardData`, já ajustado na Task 9).

- [ ] **Step 10: `src/app/(app)/sales/[id]/edit/page.tsx`**

Troque `productId`/`flavorId` lidos da venda por `itemId`/`variantId`.

- [ ] **Step 11: Typecheck**

```bash
pnpm tsc --noEmit -p . 2>&1 | grep -iE "app/\(app\)"
```

- [ ] **Step 12: Commit**

```bash
git add "src/app/(app)/stock" "src/app/(app)/products" "src/app/(app)/purchases" "src/app/(app)/admin" "src/app/(app)/dashboard" "src/app/(app)/sales"
git rm "src/app/(app)/pantry" -r --cached 2>/dev/null || true
git commit -m "$(cat <<'EOF'
refactor(paginas): /pantry vira /stock, /products perde a tab de estoque

Estoque de qualquer item (insumo ou produto acabado) passa a viver só em
/stock — /products fica só com o histórico/registro de produção.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Componentes — terminologia + lista de compras nova UI

**Files:**
- Create: `src/components/items/item-dialog.tsx` (substitui `src/components/ingredients/ingredient-dialog.tsx`)
- Create: `src/components/items/delete-item-button.tsx` (substitui `src/components/ingredients/delete-ingredient-button.tsx`)
- Delete: `src/components/ingredients/` (pasta inteira)
- Modify: `src/components/catalog/product-editor.tsx`, `src/components/catalog/active-toggle.tsx`
- Modify: `src/components/charts/flavor-mix-chart.tsx` → renomear para `src/components/charts/variant-mix-chart.tsx`
- Modify: `src/components/dashboard/dashboard-filters.tsx`
- Modify: `src/components/production/production-form.tsx`
- Modify: `src/components/purchases/ingredient-combobox.tsx` → renomear para `item-combobox.tsx`, `src/components/purchases/purchase-dialog.tsx`, `src/components/purchases/purchases-list.tsx`
- Modify: `src/components/recipes/ingredient-combobox.tsx` → renomear para `item-combobox.tsx`, `src/components/recipes/recipe-form.tsx`
- Create: `src/components/stock/shopping-list-add-form.tsx`, `src/components/stock/shopping-list-suggestions.tsx`
- Modify: `src/components/pantry/shopping-list-item-row.tsx` → mover para `src/components/stock/shopping-list-item-row.tsx`
- Delete: `src/components/pantry/shopping-list-actions.tsx` (substituído pelo form de adicionar)
- Modify: `src/app/(app)/stock/shopping-list/page.tsx` (conteúdo, continuando da Task 12)

**Interfaces:**
- Consumes: `createItem`/`updateItem`/`deleteItem`/`createItemForPurchase` (Task 6), `createShoppingListItem`/`updateShoppingListItem`/`deleteShoppingListItem`/`addSuggestedItem`/`toggleShoppingListItem` (Task 10), `getShoppingListItems`/`getShoppingListSuggestions` (Task 10).

- [ ] **Step 1: `item-dialog.tsx` (ex-`ingredient-dialog.tsx`)**

Copie o conteúdo de `src/components/ingredients/ingredient-dialog.tsx` para `src/components/items/item-dialog.tsx`, trocando: props `ingredient`→`item` (`{ id, name, unit, minStock, productionInput, sellable }`), campos de formulário `baseUnit`→`unit`, `isRawMaterial`→`productionInput`, `forResale`→`sellable`, chamadas `createIngredient`/`updateIngredient`→`createItem`/`updateItem`. Troque os rótulos visíveis: "Matéria-prima" continua (checkbox `productionInput`), "Revenda"→"Venda" (checkbox `sellable`).

- [ ] **Step 2: `delete-item-button.tsx`**

Igual ao atual `delete-ingredient-button.tsx`, trocando `deleteIngredient`→`deleteItem`.

- [ ] **Step 3: Apagar a pasta antiga**

```bash
git rm -r src/components/ingredients
```

- [ ] **Step 4: `product-editor.tsx` + `active-toggle.tsx`**

Troque `FlavorLine`→`VariantLine`, `ProductForEdit`→`ItemForEdit`, `removedFlavorIds`→`removedVariantIds`, chamada a `saveProduct`→`saveItem`; em `active-toggle.tsx`, `toggleFlavorActive`→`toggleVariantActive`.

- [ ] **Step 5: `flavor-mix-chart.tsx` → `variant-mix-chart.tsx`**

```bash
git mv src/components/charts/flavor-mix-chart.tsx src/components/charts/variant-mix-chart.tsx
```

Renomeie o componente `FlavorMixChart`→`VariantMixChart` e todo lugar que o importa (`grep -rl FlavorMixChart src/` para achar os call-sites — deve ser só `dashboard/page.tsx`, já coberto na Task 12).

- [ ] **Step 6: `dashboard-filters.tsx`**

Troque `productId`/`flavorId`→`itemId`/`variantId`, `ProductOption.flavors`→`ItemOption.variants`.

- [ ] **Step 7: `production-form.tsx`**

Troque `Product`/`Flavor` (interfaces locais)→`Item`/`Variant`, props `products`→`items`, `flavors`→`variants`, `productId`→`itemId`, `FillingLine`→`VariantLine` (`flavorId`→`variantId`), campo de formulário `fillings`→`variantLines`, rótulos visíveis "Produto"→"Item", "Sabores"→"Variantes", "Nenhum sabor cadastrado"→"Nenhuma variante cadastrada".

- [ ] **Step 8: Comboboxes de compras/receitas**

```bash
git mv src/components/purchases/ingredient-combobox.tsx src/components/purchases/item-combobox.tsx
git mv src/components/recipes/ingredient-combobox.tsx src/components/recipes/item-combobox.tsx
```

Em ambos: `PurchaseIngredientOption`/`IngredientOption`→`PurchaseItemOption`/`ItemOption`, `baseUnit`→`unit`, `forResale`/`isRawMaterial`→`sellable`/`productionInput`, chamada a `createIngredientForPurchase`/`createIngredientInline`→`createItemForPurchase`/`createItemInline`.

- [ ] **Step 9: `purchase-dialog.tsx`, `purchases-list.tsx`, `recipe-form.tsx`**

Troque `ingredientId`→`itemId` e `item.baseUnit`→`item.unit` nos três.

- [ ] **Step 10: Lista de compras — nova UI**

Crie `src/components/stock/shopping-list-add-form.tsx` (form simples: input de texto livre `label` + combobox opcional de `Item` cadastrado que preenche `itemId`+`label`+`unit` + input de quantidade, chama `createShoppingListItem`):

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createShoppingListItem } from "@/server/actions/shopping-list";

export function ShoppingListAddForm() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    const fd = new FormData();
    fd.set("label", label.trim());
    startTransition(async () => {
      const res = await createShoppingListItem(fd);
      if (!res.ok) { toast.error(res.error ?? "Não foi possível adicionar."); return; }
      setLabel("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Adicionar item… (ex.: café de casa)"
        disabled={pending}
      />
      <Button type="submit" size="icon" disabled={pending || !label.trim()}>
        <Plus className="size-4" />
      </Button>
    </form>
  );
}
```

(versão mínima com texto livre — se quiser o combobox de `Item` cadastrado no mesmo form, siga o padrão já usado em `src/components/purchases/item-combobox.tsx` da Step 8 para o autocomplete, preenchendo `itemId` num campo hidden do mesmo `FormData`.)

Crie `src/components/stock/shopping-list-suggestions.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addSuggestedItem } from "@/server/actions/shopping-list";
import { formatQty, baseUnitLabel } from "@/lib/units";
import type { ShoppingListSuggestion } from "@/server/queries/shopping-list";
import type { BaseUnit } from "@prisma/client";

export function ShoppingListSuggestions({ suggestions }: { suggestions: ShoppingListSuggestion[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (suggestions.length === 0) return null;

  function onAdd(itemId: string) {
    startTransition(async () => {
      const res = await addSuggestedItem(itemId);
      if (!res.ok) toast.error(res.error ?? "Não foi possível adicionar.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Sugestões (estoque abaixo do mínimo)</h2>
      {suggestions.map((s) => (
        <div key={s.itemId} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{s.itemName}</p>
            <p className="text-xs text-muted-foreground">
              Faltam {formatQty(s.deficit, s.unit as BaseUnit)}
            </p>
          </div>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onAdd(s.itemId)}>
            <Plus className="size-4" />
            Adicionar
          </Button>
        </div>
      ))}
    </div>
  );
}
```

Mova `shopping-list-item-row.tsx` para `src/components/stock/` e adicione edição/exclusão + o botão opcional "Registrar compra" (que redireciona para `/purchases?itemId=<id>` — a pré-preenchida efetiva do formulário de compra a partir da query string é opcional/nice-to-have; no mínimo, o link já leva a pessoa para a tela certa com o item em mente):

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Trash2, ShoppingCart } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { formatQty } from "@/lib/units";
import { toggleShoppingListItem, deleteShoppingListItem } from "@/server/actions/shopping-list";
import type { BaseUnit } from "@prisma/client";

export function ShoppingListItemRow({
  id, itemId, label, quantity, unit,
}: {
  id: string; itemId: string | null; label: string; quantity: number | null; unit: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onCheckedChange(checked: boolean) {
    startTransition(async () => {
      const res = await toggleShoppingListItem(id, checked);
      if (!res.ok) toast.error(res.error ?? "Não foi possível atualizar o item.");
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const res = await deleteShoppingListItem(id);
      if (!res.ok) toast.error(res.error ?? "Não foi possível remover o item.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <Switch checked={false} disabled={pending} onCheckedChange={onCheckedChange} aria-label="Marcar como comprado" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        {quantity != null && unit != null && (
          <p className="text-xs text-muted-foreground">{formatQty(quantity, unit as BaseUnit)}</p>
        )}
      </div>
      {itemId && (
        <Button asChild size="icon" variant="ghost" title="Registrar compra">
          <Link href={`/purchases?itemId=${itemId}`}><ShoppingCart className="size-4" /></Link>
        </Button>
      )}
      <Button size="icon" variant="ghost" disabled={pending} onClick={onDelete} title="Remover">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
```

```bash
git mv src/components/pantry/shopping-list-item-row.tsx src/components/stock/shopping-list-item-row.tsx
git rm src/components/pantry/shopping-list-actions.tsx
rmdir src/components/pantry 2>/dev/null || true
```

- [ ] **Step 11: Reescrever `src/app/(app)/stock/shopping-list/page.tsx`**

```tsx
import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { getShoppingListItems, getShoppingListSuggestions } from "@/server/queries/shopping-list";
import { ShoppingListAddForm } from "@/components/stock/shopping-list-add-form";
import { ShoppingListSuggestions } from "@/components/stock/shopping-list-suggestions";
import { ShoppingListItemRow } from "@/components/stock/shopping-list-item-row";

export default async function ShoppingListPage() {
  const [items, suggestions] = await Promise.all([
    getShoppingListItems(),
    getShoppingListSuggestions(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Lista de compras" description="Adicione o que precisar comprar." backHref="/stock" />

      <ShoppingListAddForm />

      <ShoppingListSuggestions suggestions={suggestions} />

      {items.length === 0 ? (
        <EmptyState icon={ListChecks} title="Sua lista está vazia" description="Adicione um item acima." />
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Sua lista</h2>
          {items.map((item) => (
            <ShoppingListItemRow key={item.id} id={item.id} itemId={item.itemId} label={item.label} quantity={item.quantity} unit={item.unit} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 12: Typecheck completo**

```bash
pnpm tsc --noEmit -p .
```

Resolva qualquer erro remanescente antes de seguir — essa é a primeira vez, desde a Task 1, que o projeto inteiro deve voltar a compilar.

- [ ] **Step 13: Commit**

```bash
git add src/components src/app
git commit -m "$(cat <<'EOF'
refactor(ui): componentes seguem Item/Variant; lista de compras ganha CRUD livre

Fim do fluxo "gerar lista automaticamente" — adicionar, editar e apagar
itens da lista funciona a qualquer momento; sugestões de estoque baixo
viram um clique opt-in, não criação silenciosa.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Navegação

**Files:**
- Modify: `src/components/layout/side-nav.tsx`
- Modify: `src/components/layout/bottom-nav.tsx`
- Modify: `src/app/(app)/more/page.tsx`

- [ ] **Step 1: `side-nav.tsx`**

```ts
import { LayoutDashboard, ShoppingCart, ShoppingBag, Cookie, Package, Settings, PanelLeftClose, PanelLeftOpen, LogOut, Users, Building2, type LucideIcon } from "lucide-react";
// ...
const items: NavItem[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/dashboard/consolidated", label: "Consolidado", icon: Building2 },
  { href: "/sales", label: "Vendas", icon: ShoppingCart },
  { href: "/customers", label: "Clientes", icon: Users },
  { href: "/products", label: "Produção", icon: Cookie },
  { href: "/stock", label: "Estoque", icon: Package },
  { href: "/purchases", label: "Compras", icon: ShoppingBag },
  { href: "/admin", label: "Configurações", icon: Settings, adminOnly: true },
];
```

(troquei o ícone de `UtensilsCrossed`→`Package` para a Despensa/Estoque — genérico em vez de talheres; mantive `Cookie` no item "Produção" e na marca "Coolkies" por ora, já que renomear a marca do produto está fora do escopo deste spec.)

- [ ] **Step 2: `bottom-nav.tsx`**

```ts
extraPrefixes: ["/products", "/stock", "/purchases", "/admin", "/workspaces"],
```

- [ ] **Step 3: `more/page.tsx`**

```ts
{
  href: "/products",
  label: "Produção",
  description: "Histórico de produções",
  icon: Cookie,
},
{
  href: "/stock",
  label: "Estoque",
  description: "Itens e lista de compras",
  icon: Package,
},
```

(importe `Package` de `lucide-react` no topo do arquivo; remova o import de `UtensilsCrossed` se não for mais usado em lugar nenhum do arquivo.)

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/side-nav.tsx src/components/layout/bottom-nav.tsx "src/app/(app)/more/page.tsx"
git commit -m "$(cat <<'EOF'
refactor(nav): Despensa vira Estoque (/pantry -> /stock) na navegação

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Suíte de testes completa + arquivos restantes

**Files:**
- Modify: `src/server/tenant/extension.test.ts`
- Modify: `src/server/tenant/nested-writes.test.ts`
- Verify: todo o restante da suíte

**Interfaces:**
- Consumes: tudo das Tasks 1–14.

- [ ] **Step 1: `extension.test.ts` e `nested-writes.test.ts`**

Troque toda referência a `testDb.product`/`Prisma.ProductUncheckedCreateInput`/`Prisma.ProductCreateManyAndReturnArgs`/literal `"Product"` para `testDb.item`/`Prisma.ItemUncheckedCreateInput`/`Prisma.ItemCreateManyAndReturnArgs`/`"Item"`. Esses testes usam o model só como exemplo genérico — a troca é mecânica, sem mudança de lógica de teste.

- [ ] **Step 2: Rodar a suíte inteira**

```bash
pnpm vitest run
```

- [ ] **Step 3: Corrigir qualquer teste que sobrou quebrado**

Nesse ponto, qualquer falha restante é um arquivo que passou batido pelas Tasks 1–14 — volte ao [inventário de arquivos](#) obtido durante o planejamento (ou rode `grep -rlE "\b(Ingredient|Flavor|flavorId|resaleProductId|forResale|isRawMaterial|productId)\b" src/` para achar sobras) e corrija seguindo o mesmo padrão de rename já aplicado nas tasks anteriores.

- [ ] **Step 4: Typecheck + lint completos**

```bash
pnpm tsc --noEmit -p .
pnpm lint
```

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test: fecha a migração pra Item unificado — suíte completa verde

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Cobertura do spec:**
- Decisão 1 (Item unificado) — Task 1, 6.
- Decisão 2 (StockMovement fonte única) — Task 1 (schema), 3 (leitura), 4/5 (escrita em produção/compra).
- Decisão 3 (`CONSUMPTION`) — Task 1, 4.
- Decisão 4 (renomeações Variant/RecipeItem/ProductionVariantLine) — Task 1, 7, 8.
- Decisão 5 (produção multi-estágio habilitada, sem UI) — nenhuma task constrói UI pra isso, por design (YAGNI explícito no spec).
- Decisão 6 (lista de compras livre + sugestões opt-in + registrar compra) — Task 10, 13.
- Decisão 7 (uso pessoal/negócio, `ADJUSTMENT` já existente) — nenhuma mudança necessária, comportamento preservado.
- "Fora de escopo" do spec (catálogo multi-dimensão, custeio, unificar telas admin) — nenhuma task toca nisso, confirmado.

**Placeholder scan:** nenhum "TBD"/"implementar depois". Uma rodada de self-review encontrou um erro real: os testes das Tasks 3–6 e 10 inicialmente inventavam helpers `runAsUser`/`runAsWorkspace` que não existem no repo — corrigido para o padrão real confirmado em `src/server/actions/purchases.test.ts` e `src/server/queries/dashboard.test.ts` (`vi.mock("@/server/tenant/context", ...)` com um objeto `context` mutável e `await import()` dinâmico do módulo testado). Todo bloco de teste do plano já reflete esse padrão correto.

**Consistência de tipos:** `ItemStockEntry` (Task 3) é reusado como está em `getShoppingListSuggestions` (Task 10) e nas páginas (Task 12) sem remodelagem. `VariantLineInput`/`variantLines` (Task 4) é o mesmo shape em `production.ts` (action) e no `ProductionForm` (Task 13). `ShoppingListEntry`/`ShoppingListSuggestion` (Task 10) são os tipos consumidos por `shopping-list-item-row.tsx`/`shopping-list-suggestions.tsx` (Task 13) com os mesmos nomes de campo.

---

Plano completo salvo em `docs/superpowers/plans/2026-09-16-estoque-producao-compras-generico.md`.

**Duas opções de execução:**

1. **Subagent-Driven (recomendado)** — um subagente novo por task, revisão entre tasks, iteração rápida.
2. **Execução inline** — executo as tasks nesta sessão via `executing-plans`, em lote com checkpoints pra revisão.

Qual prefere?
