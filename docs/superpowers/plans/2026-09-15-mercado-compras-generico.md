# Mercado e Compras genérico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o módulo de Mercado/Compras (hoje burocrático e específico de confeitaria) por um fluxo de Compras genérico: insumos podem ser matéria-prima e/ou revenda, uma compra registra vários itens de uma vez, fornecedor é opcional e criado na hora, e o lucro do dashboard passa a descontar o custo dos itens revendidos.

**Architecture:** `Market`/`IngredientPurchase` viram `Supplier` (opcional) + `Purchase`/`PurchaseItem` (cabeçalho + linhas). `Ingredient` ganha `isRawMaterial`/`forResale`; ao marcar `forResale`, um `Product` é criado/reativado automaticamente para o insumo poder ser vendido pelo Catálogo já existente. A fórmula "custo = última compra ÷ quantidade", hoje duplicada em 4 lugares, vira um único helper (`src/server/queries/purchase-cost.ts`). O dashboard passa a somar dois caminhos de COGS por venda: produção (como hoje) e "última compra do insumo × quantidade vendida" para produtos ligados a um insumo de revenda.

**Tech Stack:** Next.js 15 (App Router) + Prisma 6/PostgreSQL + Vitest (testes rodam contra um Postgres real via `testDb`, sem mocks de Prisma) + React 19 + Tailwind/shadcn-ui.

**Spec:** [docs/superpowers/specs/2026-09-15-mercado-compras-generico-design.md](../specs/2026-09-15-mercado-compras-generico-design.md)

## Global Constraints

- **Gerenciador de pacotes:** sempre `pnpm` (nunca `npm`/`yarn` — já quebraram o ambiente antes).
- **Migrations são escritas à mão.** Nunca rodar `prisma migrate dev`/`deploy`. Fluxo: editar `prisma/schema.prisma` → criar `prisma/migrations/<timestamp>_<nome>/migration.sql` à mão → aplicar via `docker exec -i cookies_db psql -U cookies -d cookies` e `-d cookies_test` → `pnpm exec prisma generate`.
- **Banco de teste:** `testDb` (`src/test/db.ts`) aponta pro Postgres real do container `cookies_db`, banco `cookies_test`. `resetDb()` faz `TRUNCATE ... CASCADE` numa lista fixa de tabelas — toda tabela nova precisa ser adicionada a essa lista.
- **Testes rodam com:** `pnpm exec vitest run <caminho>` (não `pnpm test` inteiro a cada task — várias tasks deste plano deixam o restante do código-fonte referenciando nomes antigos até a Task 11; só espere `pnpm exec tsc --noEmit` e `pnpm test` 100% verdes depois da última task).
- **Nunca usar `sed`/scripts automáticos para renomear em massa** — os arquivos têm nuances (nomes de variável, mensagens de erro em português, imports) que exigem edição deliberada.
- **Sem comentários inline no código novo**, salvo para justificar uma decisão não óbvia (convenção do projeto).

---

## Task 1: Schema — Insumo genérico, Fornecedor, Compra em cabeçalho+itens

**Files:**
- Modify: `prisma/schema.prisma:447-502` (bloco "INGREDIENTES, MERCADOS E COMPRAS")
- Modify: `prisma/schema.prisma:187-216` (relations do `Workspace`)
- Modify: `prisma/schema.prisma:25-45` (relations do `User`)
- Modify: `prisma/schema.prisma:251-269` (`Product`, para a relação inversa de `resaleProductId`)
- Modify: `prisma/schema.prisma:593-597` (`StockMovementType`)
- Create: `prisma/migrations/20260915120000_generic_purchases_and_resale/migration.sql`
- Modify: `src/test/db.ts`

**Interfaces:**
- Produces: modelos Prisma `Supplier`, `Purchase`, `PurchaseItem`; campos `Ingredient.isRawMaterial`, `Ingredient.forResale`, `Ingredient.resaleProductId`; valor de enum `StockMovementType.PURCHASE`. Toda task seguinte depende destes nomes exatos.

- [ ] **Step 1: Editar `prisma/schema.prisma` — generalizar `Ingredient`**

Substituir o bloco (linhas 447-464):

```prisma
model Ingredient {
  id        String   @id @default(cuid())
  name      String // ex.: "Açúcar"
  baseUnit  BaseUnit @default(G)
  minStock  Float?   @default(0) // estoque mínimo na unidade base (para alertas)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  purchases         IngredientPurchase[]
  recipeIngredients RecipeIngredient[]
  shoppingItems     ShoppingListItem[]

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, name])
  @@map("ingredient")
}
```

por:

```prisma
model Ingredient {
  id        String   @id @default(cuid())
  name      String // ex.: "Açúcar"
  baseUnit  BaseUnit @default(G)
  minStock  Float?   @default(0) // estoque mínimo na unidade base (para alertas)

  isRawMaterial Boolean @default(true) // entra em receita/produção
  forResale     Boolean @default(false) // vira produto vendável

  resaleProductId String?  @unique
  resaleProduct   Product? @relation(fields: [resaleProductId], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  purchaseItems     PurchaseItem[]
  recipeIngredients RecipeIngredient[]
  shoppingItems     ShoppingListItem[]

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, name])
  @@map("ingredient")
}
```

- [ ] **Step 2: Editar `prisma/schema.prisma` — `Market` vira `Supplier`, `IngredientPurchase` vira `Purchase`+`PurchaseItem`**

Substituir o bloco (linhas 466-502):

```prisma
model Market {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  purchases IngredientPurchase[]

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, name])
  @@map("market")
}

// Compra de ingrediente: base para custo por unidade.
model IngredientPurchase {
  id           String     @id @default(cuid())
  marketId     String
  market       Market     @relation(fields: [marketId], references: [id], onDelete: Cascade)
  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Cascade)
  userId       String?
  user         User?      @relation(fields: [userId], references: [id])

  quantity   Float // quantidade comprada na unidade abaixo
  unit       BaseUnit // unidade da compra (ex.: comprei em KG -> normalizar p/ base)
  pricePaidCents Int // valor pago em centavos
  purchasedAt DateTime @default(now())
  createdAt  DateTime @default(now())

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, ingredientId, purchasedAt])
  @@map("ingredient_purchase")
}
```

por:

```prisma
model Supplier {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  purchases Purchase[]

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, name])
  @@map("supplier")
}

// Cabeçalho de uma compra: um fornecedor (opcional), vários itens.
model Purchase {
  id         String    @id @default(cuid())
  supplierId String?
  supplier   Supplier? @relation(fields: [supplierId], references: [id], onDelete: SetNull)
  userId     String?
  user       User?     @relation(fields: [userId], references: [id])

  purchasedAt DateTime @default(now())
  notes       String?
  createdAt   DateTime @default(now())

  items PurchaseItem[]

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, purchasedAt])
  @@map("purchase")
}

// Linha de uma compra: um insumo, quantidade e preço pago. Base para custo por unidade.
model PurchaseItem {
  id           String     @id @default(cuid())
  purchaseId   String
  purchase     Purchase   @relation(fields: [purchaseId], references: [id], onDelete: Cascade)
  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Cascade)

  quantity       Float // quantidade comprada na unidade base do ingrediente
  unit           BaseUnit
  pricePaidCents Int // valor pago em centavos por esta linha
  createdAt      DateTime @default(now())

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, ingredientId])
  @@map("purchase_item")
}
```

- [ ] **Step 3: Editar `prisma/schema.prisma` — relação inversa em `Product`**

Em `model Product` (linhas 251-269), adicionar junto às outras relações (depois de `productionBatches ProductionBatch[]`):

```prisma
  resaleIngredient Ingredient?
```

- [ ] **Step 4: Editar `prisma/schema.prisma` — `StockMovementType` ganha `PURCHASE`**

Substituir (linhas 593-597):

```prisma
enum StockMovementType {
  PRODUCTION // +
  SALE // -
  ADJUSTMENT // ±
}
```

por:

```prisma
enum StockMovementType {
  PRODUCTION // +
  SALE // -
  ADJUSTMENT // ±
  PURCHASE // + (compra de insumo marcado para revenda)
}
```

- [ ] **Step 5: Editar `prisma/schema.prisma` — relations de `Workspace` e `User`**

Em `model Workspace` (linhas 187-216), trocar:

```prisma
  ingredients        Ingredient[]
  markets            Market[]
  ingredientPurchases IngredientPurchase[]
```

por:

```prisma
  ingredients        Ingredient[]
  suppliers          Supplier[]
  purchases          Purchase[]
  purchaseItems      PurchaseItem[]
```

Em `model User` (linhas 25-45), trocar:

```prisma
  productionBatches ProductionBatch[]
  ingredientPurchases IngredientPurchase[]
```

por:

```prisma
  productionBatches ProductionBatch[]
  purchases         Purchase[]
```

- [ ] **Step 6: Criar a migration SQL**

Criar `prisma/migrations/20260915120000_generic_purchases_and_resale/migration.sql`:

```sql
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
```

- [ ] **Step 7: Aplicar a migration nos dois bancos**

```bash
docker exec -i cookies_db psql -U cookies -d cookies < prisma/migrations/20260915120000_generic_purchases_and_resale/migration.sql
docker exec -i cookies_db psql -U cookies -d cookies_test < prisma/migrations/20260915120000_generic_purchases_and_resale/migration.sql
```

Confirmar que ambos os comandos terminam sem erro (cada `ALTER`/`CREATE` deve imprimir `ALTER TABLE`, `CREATE TABLE` etc., sem `ERROR:`).

- [ ] **Step 8: Regenerar o client do Prisma**

```bash
pnpm exec prisma generate
```

- [ ] **Step 9: Atualizar a lista de tabelas do `resetDb()`**

Em `src/test/db.ts`, no array `TABLES`, remover `"ingredient_purchase"` e `"market"`, adicionar `"purchase_item"`, `"purchase"` e `"supplier"`:

```ts
const TABLES = [
  "member",
  "invitation",
  "workspace",
  "user",
  "processed_webhook_event",
  "stock_movement",
  "production_filling",
  "production_batch",
  "shopping_list_item",
  "recipe_ingredient",
  "purchase_item",
  "purchase",
  "sale_item",
  "sale",
  "price_history",
  "price_list_item",
  "flavor",
  "product",
  "recipe",
  "ingredient",
  "supplier",
  "customer",
];
```

- [ ] **Step 10: Confirmar que o schema é válido**

```bash
pnpm exec prisma validate
```

Esperado: `The schema at prisma/schema.prisma is valid 🚀`.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260915120000_generic_purchases_and_resale/migration.sql src/test/db.ts
git commit -m "$(cat <<'EOF'
feat(db): generaliza insumo (matéria-prima/revenda) e compra em cabeçalho+itens

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Helper de custo consolidado

**Files:**
- Create: `src/server/queries/purchase-cost.ts`
- Create: `src/server/queries/purchase-cost.test.ts`
- Modify: `src/lib/money.ts` (remover `unitCost`, morto e não usado por ninguém)

**Interfaces:**
- Consumes: modelos `PurchaseItem`/`Purchase` (Task 1).
- Produces: `unitCostFromLastPurchase(last: PurchasePrice | null): number | null`, `getLastPurchase(db, ingredientId, supplierId?): Promise<LastPurchaseInfo | null>`, tipo `LastPurchaseInfo`. Usados pelas Tasks 3, 4, 5, 6.

- [ ] **Step 1: Escrever o teste**

Criar `src/server/queries/purchase-cost.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { unitCostFromLastPurchase, getLastPurchase } from "./purchase-cost";

describe("unitCostFromLastPurchase", () => {
  it("divide preço pago pela quantidade", () => {
    expect(unitCostFromLastPurchase({ quantity: 1000, pricePaidCents: 250 })).toBe(0.25);
  });

  it("retorna null sem compra", () => {
    expect(unitCostFromLastPurchase(null)).toBeNull();
  });

  it("retorna null com quantidade zero", () => {
    expect(unitCostFromLastPurchase({ quantity: 0, pricePaidCents: 250 })).toBeNull();
  });
});

describe("getLastPurchase", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("retorna null quando o insumo nunca foi comprado", async () => {
    const workspace = await createWorkspace("Confeitaria");
    const ingredient = await testDb.ingredient.create({
      data: { name: "Açúcar", baseUnit: "G", workspaceId: workspace.id },
    });

    const result = await getLastPurchase(testDb, ingredient.id);
    expect(result).toBeNull();
  });

  it("retorna a compra mais recente entre todos os fornecedores", async () => {
    const workspace = await createWorkspace("Confeitaria 2");
    const ingredient = await testDb.ingredient.create({
      data: { name: "Farinha", baseUnit: "G", workspaceId: workspace.id },
    });
    const supplierA = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    const supplierB = await testDb.supplier.create({
      data: { name: "Sam's Club", workspaceId: workspace.id },
    });

    const older = await testDb.purchase.create({
      data: { supplierId: supplierA.id, purchasedAt: new Date("2026-01-01"), workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: older.id, ingredientId: ingredient.id, quantity: 1000, unit: "G", pricePaidCents: 400, workspaceId: workspace.id },
    });

    const newer = await testDb.purchase.create({
      data: { supplierId: supplierB.id, purchasedAt: new Date("2026-02-01"), workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: newer.id, ingredientId: ingredient.id, quantity: 500, unit: "G", pricePaidCents: 300, workspaceId: workspace.id },
    });

    const result = await getLastPurchase(testDb, ingredient.id);
    expect(result).toMatchObject({ quantity: 500, pricePaidCents: 300, supplierId: supplierB.id });
  });

  it("filtra pela compra mais recente de um fornecedor específico", async () => {
    const workspace = await createWorkspace("Confeitaria 3");
    const ingredient = await testDb.ingredient.create({
      data: { name: "Ovos", baseUnit: "UN", workspaceId: workspace.id },
    });
    const supplierA = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    const supplierB = await testDb.supplier.create({
      data: { name: "Sam's Club", workspaceId: workspace.id },
    });

    const purchaseA = await testDb.purchase.create({
      data: { supplierId: supplierA.id, purchasedAt: new Date("2026-01-01"), workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchaseA.id, ingredientId: ingredient.id, quantity: 12, unit: "UN", pricePaidCents: 1200, workspaceId: workspace.id },
    });

    const purchaseB = await testDb.purchase.create({
      data: { supplierId: supplierB.id, purchasedAt: new Date("2026-02-01"), workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchaseB.id, ingredientId: ingredient.id, quantity: 30, unit: "UN", pricePaidCents: 3600, workspaceId: workspace.id },
    });

    const result = await getLastPurchase(testDb, ingredient.id, supplierA.id);
    expect(result).toMatchObject({ quantity: 12, pricePaidCents: 1200, supplierId: supplierA.id });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
pnpm exec vitest run src/server/queries/purchase-cost.test.ts
```

Esperado: falha porque `./purchase-cost` não existe.

- [ ] **Step 3: Implementar `purchase-cost.ts`**

Criar `src/server/queries/purchase-cost.ts`:

```ts
import type { PrismaClient, BaseUnit } from "@prisma/client";

export type PurchasePrice = { quantity: number; pricePaidCents: number };

/** Custo por unidade base a partir de preço pago ÷ quantidade. Único ponto que faz essa conta. */
export function unitCostFromLastPurchase(last: PurchasePrice | null): number | null {
  if (!last || last.quantity <= 0) return null;
  return last.pricePaidCents / last.quantity;
}

export type LastPurchaseInfo = PurchasePrice & {
  unit: BaseUnit;
  purchasedAt: Date;
  supplierId: string | null;
};

/** Compra mais recente de um insumo, opcionalmente filtrada por fornecedor. */
export async function getLastPurchase(
  db: PrismaClient,
  ingredientId: string,
  supplierId?: string,
): Promise<LastPurchaseInfo | null> {
  const item = await db.purchaseItem.findFirst({
    where: {
      ingredientId,
      ...(supplierId ? { purchase: { supplierId } } : {}),
    },
    orderBy: { purchase: { purchasedAt: "desc" } },
    select: {
      quantity: true,
      unit: true,
      pricePaidCents: true,
      purchase: { select: { purchasedAt: true, supplierId: true } },
    },
  });
  if (!item) return null;

  return {
    quantity: item.quantity,
    unit: item.unit,
    pricePaidCents: item.pricePaidCents,
    purchasedAt: item.purchase.purchasedAt,
    supplierId: item.purchase.supplierId,
  };
}
```

- [ ] **Step 4: Rodar o teste de novo**

```bash
pnpm exec vitest run src/server/queries/purchase-cost.test.ts
```

Esperado: 5 testes passando.

- [ ] **Step 5: Remover `unitCost` morto de `src/lib/money.ts`**

Em `src/lib/money.ts`, remover o bloco final (a função nunca é chamada em nenhum lugar do código — confirmado por busca antes de escrever este plano):

```ts
/**
 * Custo por unidade base a partir de uma compra.
 * Ex.: paguei 250 centavos por 1000g -> 0.25 centavos/g.
 * Retorna centavos por unidade (pode ser fracionário).
 */
export function unitCost(pricePaidCents: number, quantity: number): number {
  if (quantity <= 0) return 0;
  return pricePaidCents / quantity;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/server/queries/purchase-cost.ts src/server/queries/purchase-cost.test.ts src/lib/money.ts
git commit -m "$(cat <<'EOF'
feat(purchases): consolida cálculo de custo por unidade num helper único

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Insumo — matéria-prima/revenda + vínculo automático com Produto

**Files:**
- Modify: `src/server/actions/ingredients.ts`
- Modify: `src/server/queries/ingredients.ts`
- Create: `src/server/actions/ingredients.test.ts`

**Interfaces:**
- Consumes: `unitCostFromLastPurchase` (Task 2).
- Produces: `createIngredient`/`updateIngredient` aceitam `isRawMaterial`/`forResale` no `FormData`; `createIngredientForPurchase(formData): Promise<ActionResult<IngredientInlineData>>` (usada pela Task 4/10); tipo `IngredientInlineData = { id, name, baseUnit, isRawMaterial, forResale }`. `getIngredientsWithLastCost()` retorna `isRawMaterial`/`forResale`/`resaleProductId` em cada item.

- [ ] **Step 1: Escrever os testes de comportamento de revenda**

Criar `src/server/actions/ingredients.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { createIngredient, updateIngredient, createIngredientForPurchase } = await import("./ingredients");

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("createIngredient — revenda", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria insumo só de matéria-prima sem produto vinculado", async () => {
    const res = await createIngredient(
      fd({ name: "Açúcar", baseUnit: "G", isRawMaterial: "on" }),
    );
    expect(res.ok).toBe(true);

    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Açúcar" } });
    expect(ing.isRawMaterial).toBe(true);
    expect(ing.forResale).toBe(false);
    expect(ing.resaleProductId).toBeNull();
  });

  it("cria insumo de revenda com produto vinculado automaticamente", async () => {
    const res = await createIngredient(
      fd({ name: "Refrigerante", baseUnit: "UN", forResale: "on" }),
    );
    expect(res.ok).toBe(true);

    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Refrigerante" } });
    expect(ing.forResale).toBe(true);
    expect(ing.resaleProductId).not.toBeNull();

    const product = await testDb.product.findUniqueOrThrow({ where: { id: ing.resaleProductId! } });
    expect(product.name).toBe("Refrigerante");
    expect(product.active).toBe(true);
  });

  it("recusa insumo sem nenhuma finalidade marcada", async () => {
    const res = await createIngredient(fd({ name: "Sem finalidade", baseUnit: "G" }));
    expect(res.ok).toBe(false);
  });
});

describe("updateIngredient — transição de revenda", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 2");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("ao marcar revenda numa edição, cria o produto vinculado", async () => {
    await createIngredient(fd({ name: "Suco", baseUnit: "UN", isRawMaterial: "on" }));
    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Suco" } });
    expect(ing.resaleProductId).toBeNull();

    await updateIngredient(ing.id, fd({ name: "Suco", baseUnit: "UN", isRawMaterial: "on", forResale: "on" }));

    const updated = await testDb.ingredient.findUniqueOrThrow({ where: { id: ing.id } });
    expect(updated.forResale).toBe(true);
    expect(updated.resaleProductId).not.toBeNull();
  });

  it("ao desmarcar revenda, desativa o produto em vez de apagar", async () => {
    await createIngredient(fd({ name: "Água", baseUnit: "UN", forResale: "on" }));
    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Água" } });
    const productId = ing.resaleProductId!;

    await updateIngredient(ing.id, fd({ name: "Água", baseUnit: "UN", isRawMaterial: "on" }));

    const updated = await testDb.ingredient.findUniqueOrThrow({ where: { id: ing.id } });
    expect(updated.forResale).toBe(false);
    expect(updated.resaleProductId).toBe(productId);

    const product = await testDb.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.active).toBe(false);
  });

  it("ao marcar revenda de novo, reativa o produto existente em vez de duplicar", async () => {
    await createIngredient(fd({ name: "Salgadinho", baseUnit: "UN", forResale: "on" }));
    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Salgadinho" } });
    const productId = ing.resaleProductId!;
    await updateIngredient(ing.id, fd({ name: "Salgadinho", baseUnit: "UN", isRawMaterial: "on" }));

    await updateIngredient(ing.id, fd({ name: "Salgadinho", baseUnit: "UN", forResale: "on" }));

    const updated = await testDb.ingredient.findUniqueOrThrow({ where: { id: ing.id } });
    expect(updated.resaleProductId).toBe(productId);
    const product = await testDb.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.active).toBe(true);

    const count = await testDb.product.count({ where: { name: "Salgadinho" } });
    expect(count).toBe(1);
  });
});

describe("createIngredientForPurchase", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 3");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria insumo de revenda direto do fluxo de compra", async () => {
    const res = await createIngredientForPurchase(
      fd({ name: "Chocolate quente", baseUnit: "UN", forResale: "on" }),
    );
    expect(res.ok).toBe(true);
    expect(res.data?.forResale).toBe(true);

    const ing = await testDb.ingredient.findFirstOrThrow({ where: { name: "Chocolate quente" } });
    expect(ing.resaleProductId).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm exec vitest run src/server/actions/ingredients.test.ts
```

Esperado: falha (campos/função ainda não existem).

- [ ] **Step 3: Implementar em `src/server/actions/ingredients.ts`**

Substituir o conteúdo inteiro do arquivo por:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { normalizeName } from "@/lib/text";
import { BaseUnit, type PrismaClient } from "@prisma/client";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function parseBaseUnit(value: string): BaseUnit {
  if (value === "ML") return BaseUnit.ML;
  if (value === "UN") return BaseUnit.UN;
  return BaseUnit.G;
}

function parseResaleFlags(formData: FormData): { isRawMaterial: boolean; forResale: boolean } {
  return {
    isRawMaterial: formData.get("isRawMaterial") === "on",
    forResale: formData.get("forResale") === "on",
  };
}

type ScopedClient = Awaited<ReturnType<typeof getScopedDb>>["db"];

/**
 * Garante que o Product vinculado a um insumo reflita a finalidade "revenda":
 * cria na primeira vez, reativa se já existia, desativa (sem apagar) quando
 * o insumo deixa de ser revenda.
 */
async function syncResaleProduct(
  db: ScopedClient | PrismaClient,
  workspaceId: string,
  existingProductId: string | null,
  forResale: boolean,
  name: string,
): Promise<string | null> {
  if (forResale) {
    if (existingProductId) {
      await db.product.update({ where: { id: existingProductId }, data: { name, active: true } });
      return existingProductId;
    }
    const product = await db.product.create({ data: { name, workspaceId } });
    return product.id;
  }
  if (existingProductId) {
    await db.product.update({ where: { id: existingProductId }, data: { active: false } });
  }
  return existingProductId;
}

export async function createIngredient(formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const baseUnit = parseBaseUnit(String(formData.get("baseUnit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;
  const { isRawMaterial, forResale } = parseResaleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };
  if (!isRawMaterial && !forResale) return { ok: false, error: "Marque matéria-prima e/ou revenda." };

  try {
    let resaleProductId: string | null = null;
    if (forResale) {
      const product = await db.product.create({ data: { name, workspaceId } });
      resaleProductId = product.id;
    }
    await db.ingredient.create({
      data: { name, baseUnit, minStock, isRawMaterial, forResale, resaleProductId, workspaceId },
    });
  } catch {
    return { ok: false, error: "Já existe um ingrediente ou produto com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function updateIngredient(id: string, formData: FormData): Promise<ActionResult> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const baseUnit = parseBaseUnit(String(formData.get("baseUnit") ?? "G"));
  const minStockRaw = String(formData.get("minStock") ?? "").trim();
  const minStock = minStockRaw ? parseFloat(minStockRaw.replace(",", ".")) : null;
  const { isRawMaterial, forResale } = parseResaleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (minStock !== null && isNaN(minStock)) return { ok: false, error: "Estoque mínimo inválido." };
  if (!isRawMaterial && !forResale) return { ok: false, error: "Marque matéria-prima e/ou revenda." };

  try {
    const existing = await db.ingredient.findUniqueOrThrow({
      where: { id },
      select: { resaleProductId: true },
    });
    const resaleProductId = await syncResaleProduct(db, workspaceId, existing.resaleProductId, forResale, name);
    await db.ingredient.update({
      where: { id },
      data: { name, baseUnit, minStock, isRawMaterial, forResale, resaleProductId },
    });
  } catch {
    return { ok: false, error: "Já existe um ingrediente ou produto com esse nome." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export async function deleteIngredient(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  try {
    await db.ingredient.delete({ where: { id } });
  } catch {
    return { ok: false, error: "Não foi possível excluir. O ingrediente pode estar em uso." };
  }

  revalidatePath("/admin/ingredients");
  return { ok: true };
}

export type IngredientInlineData = {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  isRawMaterial: boolean;
  forResale: boolean;
};

/** Criação inline usada pelo formulário de compra (Task 4/10) — permite já marcar revenda. */
export async function createIngredientForPurchase(
  formData: FormData,
): Promise<ActionResult<IngredientInlineData>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(String(formData.get("name") ?? ""));
  const baseUnit = parseBaseUnit(String(formData.get("baseUnit") ?? "G"));
  const { isRawMaterial, forResale } = parseResaleFlags(formData);

  if (!name) return { ok: false, error: "Nome obrigatório." };
  if (!isRawMaterial && !forResale) return { ok: false, error: "Marque matéria-prima e/ou revenda." };

  try {
    let resaleProductId: string | null = null;
    if (forResale) {
      const product = await db.product.create({ data: { name, workspaceId } });
      resaleProductId = product.id;
    }
    const ingredient = await db.ingredient.create({
      data: { name, baseUnit, isRawMaterial, forResale, resaleProductId, workspaceId },
    });
    revalidatePath("/admin/ingredients");
    return {
      ok: true,
      data: { id: ingredient.id, name: ingredient.name, baseUnit: ingredient.baseUnit, isRawMaterial, forResale },
    };
  } catch {
    return { ok: false, error: "Já existe um ingrediente ou produto com esse nome." };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm exec vitest run src/server/actions/ingredients.test.ts
```

Esperado: todos os testes passando.

- [ ] **Step 5: Atualizar `src/server/queries/ingredients.ts`**

Substituir o conteúdo inteiro por:

```ts
import { getWorkspaceDb } from "@/server/tenant/context";
import { unitCostFromLastPurchase } from "./purchase-cost";

export type IngredientWithCost = Awaited<
  ReturnType<typeof getIngredientsWithLastCost>
>[number];

export async function getIngredientsWithLastCost() {
  const db = await getWorkspaceDb();
  const ingredients = await db.ingredient.findMany({
    orderBy: { name: "asc" },
    include: {
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        select: { quantity: true, pricePaidCents: true },
      },
    },
  });

  return ingredients.map((ing) => {
    const last = ing.purchaseItems[0] ?? null;
    const unitCostCents = unitCostFromLastPurchase(last);
    const { purchaseItems, ...rest } = ing;
    return { ...rest, lastPurchase: last, unitCostCents };
  });
}
```

- [ ] **Step 6: Rodar todos os testes que já existem para esses arquivos**

```bash
pnpm exec vitest run src/server/actions/ingredients.test.ts src/server/queries/purchase-cost.test.ts
```

Esperado: verde. (Ainda não compila o projeto inteiro — `admin/ingredients/page.tsx` e `ingredient-dialog.tsx` só serão atualizados na Task 8.)

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/ingredients.ts src/server/actions/ingredients.test.ts src/server/queries/ingredients.ts
git commit -m "$(cat <<'EOF'
feat(ingredients): insumo com matéria-prima/revenda e produto vinculado automático

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Fornecedor + Compra — server actions/queries

**Files:**
- Create: `src/server/actions/purchases.ts`
- Create: `src/server/queries/purchases.ts`
- Create: `src/server/actions/purchases.test.ts`
- Delete: `src/server/actions/markets.ts`
- Delete: `src/server/queries/markets.ts`

**Interfaces:**
- Consumes: `getLastPurchase` (Task 2); `Ingredient.forResale`/`resaleProductId` (Task 3); `toBaseUnit` (`src/lib/units.ts`, já existe).
- Produces: `createSupplierInline`, `updateSupplier`, `deleteSupplier`, `createPurchase`, `deletePurchase`, `fetchLastPriceForSupplierItem` (actions); `getSuppliers`, `getPurchases` (queries). Usados pelas Tasks 9, 10, 11.

- [ ] **Step 1: Escrever os testes do fluxo de compra**

Criar `src/server/actions/purchases.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { scopedDb } from "@/server/tenant/extension";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context = { workspaceId: "", userId: "u1", canWrite: true };

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

const { createSupplierInline, createPurchase, deletePurchase, fetchLastPriceForSupplierItem } =
  await import("./purchases");

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("createSupplierInline", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("cria um fornecedor com apenas o nome", async () => {
    const res = await createSupplierInline(fd({ name: "Atacadão" }));
    expect(res.ok).toBe(true);
    expect(res.data?.name).toBe("Atacadão");
  });

  it("recusa nome duplicado", async () => {
    await createSupplierInline(fd({ name: "Atacadão" }));
    const res = await createSupplierInline(fd({ name: "Atacadão" }));
    expect(res.ok).toBe(false);
  });
});

describe("createPurchase", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 2");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("registra vários itens numa única compra, sem fornecedor", async () => {
    const acucar = await testDb.ingredient.create({
      data: { name: "Açúcar", baseUnit: "G", workspaceId: context.workspaceId },
    });
    const farinha = await testDb.ingredient.create({
      data: { name: "Farinha", baseUnit: "G", workspaceId: context.workspaceId },
    });

    const res = await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([
          { ingredientId: acucar.id, quantity: 1, unit: "KG", pricePaidCents: 500 },
          { ingredientId: farinha.id, quantity: 2, unit: "KG", pricePaidCents: 900 },
        ]),
      }),
    );

    expect(res.ok).toBe(true);
    const purchases = await testDb.purchase.findMany({ include: { items: true } });
    expect(purchases).toHaveLength(1);
    expect(purchases[0].supplierId).toBeNull();
    expect(purchases[0].items).toHaveLength(2);
    const acucarItem = purchases[0].items.find((i) => i.ingredientId === acucar.id)!;
    expect(acucarItem.quantity).toBe(1000);
    expect(acucarItem.unit).toBe("G");
  });

  it("emite StockMovement de compra para insumo de revenda", async () => {
    const product = await testDb.product.create({
      data: { name: "Refrigerante", workspaceId: context.workspaceId },
    });
    const refri = await testDb.ingredient.create({
      data: {
        name: "Refrigerante", baseUnit: "UN", isRawMaterial: false, forResale: true,
        resaleProductId: product.id, workspaceId: context.workspaceId,
      },
    });

    await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([{ ingredientId: refri.id, quantity: 24, unit: "UN", pricePaidCents: 4800 }]),
      }),
    );

    const movements = await testDb.stockMovement.findMany({ where: { productId: product.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "PURCHASE", quantity: 24 });
  });

  it("não emite StockMovement para insumo só de matéria-prima", async () => {
    const acucar = await testDb.ingredient.create({
      data: { name: "Açúcar", baseUnit: "G", workspaceId: context.workspaceId },
    });

    await createPurchase(
      fd({
        supplierId: "",
        purchasedAt: "2026-09-15",
        items: JSON.stringify([{ ingredientId: acucar.id, quantity: 1, unit: "KG", pricePaidCents: 500 }]),
      }),
    );

    const movements = await testDb.stockMovement.count();
    expect(movements).toBe(0);
  });

  it("recusa compra sem itens", async () => {
    const res = await createPurchase(fd({ supplierId: "", purchasedAt: "2026-09-15", items: "[]" }));
    expect(res.ok).toBe(false);
  });
});

describe("deletePurchase", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 3");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("exclui a compra e todos os seus itens", async () => {
    const ing = await testDb.ingredient.create({
      data: { name: "Ovos", baseUnit: "UN", workspaceId: context.workspaceId },
    });
    const purchase = await testDb.purchase.create({ data: { workspaceId: context.workspaceId } });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchase.id, ingredientId: ing.id, quantity: 12, unit: "UN", pricePaidCents: 1200, workspaceId: context.workspaceId },
    });

    const res = await deletePurchase(purchase.id);
    expect(res.ok).toBe(true);
    expect(await testDb.purchase.count()).toBe(0);
    expect(await testDb.purchaseItem.count()).toBe(0);
  });
});

describe("fetchLastPriceForSupplierItem", () => {
  beforeEach(async () => {
    await resetDb();
    const workspace = await createWorkspace("Confeitaria 4");
    context.workspaceId = workspace.id;
    context.canWrite = true;
  });

  it("retorna o preço lembrado daquele fornecedor+insumo", async () => {
    const ing = await testDb.ingredient.create({
      data: { name: "Açúcar", baseUnit: "G", workspaceId: context.workspaceId },
    });
    const supplier = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: context.workspaceId },
    });
    const purchase = await testDb.purchase.create({
      data: { supplierId: supplier.id, workspaceId: context.workspaceId },
    });
    await testDb.purchaseItem.create({
      data: { purchaseId: purchase.id, ingredientId: ing.id, quantity: 1000, unit: "G", pricePaidCents: 450, workspaceId: context.workspaceId },
    });

    const result = await fetchLastPriceForSupplierItem(supplier.id, ing.id);
    expect(result).toMatchObject({ quantity: 1000, unit: "G", pricePaidCents: 450 });
  });

  it("retorna null quando o par fornecedor+insumo nunca teve compra", async () => {
    const ing = await testDb.ingredient.create({
      data: { name: "Farinha", baseUnit: "G", workspaceId: context.workspaceId },
    });
    const supplier = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: context.workspaceId },
    });

    const result = await fetchLastPriceForSupplierItem(supplier.id, ing.id);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm exec vitest run src/server/actions/purchases.test.ts
```

Esperado: falha (`./purchases` não existe).

- [ ] **Step 3: Implementar `src/server/actions/purchases.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { StockMovementType, type BaseUnit } from "@prisma/client";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import { normalizeName } from "@/lib/text";
import { toBaseUnit, type InputUnit } from "@/lib/units";
import { getLastPurchase } from "@/server/queries/purchase-cost";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

// ─── Fornecedores ────────────────────────────────────────────────────────────

export async function createSupplierInline(
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  const { db, workspaceId } = await getScopedDb();
  await assertCanWrite();
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!name) return { ok: false, error: "Nome é obrigatório." };

  try {
    const supplier = await db.supplier.create({ data: { name, workspaceId } });
    revalidatePath("/purchases");
    return { ok: true, data: { id: supplier.id, name: supplier.name } };
  } catch {
    return { ok: false, error: "Já existe um fornecedor com esse nome." };
  }
}

export async function updateSupplier(id: string, formData: FormData): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!name) return { ok: false, error: "Nome é obrigatório." };

  try {
    await db.supplier.update({ where: { id }, data: { name } });
    revalidatePath("/purchases");
    return { ok: true };
  } catch {
    return { ok: false, error: "Já existe um fornecedor com esse nome." };
  }
}

export async function deleteSupplier(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  try {
    await db.supplier.delete({ where: { id } });
    revalidatePath("/purchases");
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível excluir." };
  }
}

// ─── Compras ──────────────────────────────────────────────────────────────────

type PurchaseItemInput = {
  ingredientId: string;
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
    if (!item.ingredientId) return { ok: false, error: "Selecione o insumo em todos os itens." };
    if (!item.quantity || item.quantity <= 0) return { ok: false, error: "Quantidade inválida em algum item." };
    if (!item.pricePaidCents || item.pricePaidCents <= 0) {
      return { ok: false, error: "Informe o preço pago em todos os itens." };
    }
  }

  const ingredients = await db.ingredient.findMany({
    where: { id: { in: items.map((i) => i.ingredientId) } },
    select: { id: true, baseUnit: true, forResale: true, resaleProductId: true },
  });
  const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

  const purchase = await db.purchase.create({
    data: {
      supplierId,
      userId,
      purchasedAt,
      workspaceId,
      items: {
        create: items.map((item) => {
          const ing = ingredientMap.get(item.ingredientId);
          const { quantity, unit } = toBaseUnit(item.quantity, item.unit, ing?.baseUnit);
          return {
            ingredientId: item.ingredientId,
            quantity,
            unit,
            pricePaidCents: item.pricePaidCents,
            workspaceId,
          };
        }),
      },
    },
    include: { items: true },
  });

  for (const created of purchase.items) {
    const ing = ingredientMap.get(created.ingredientId);
    if (ing?.forResale && ing.resaleProductId) {
      await db.stockMovement.create({
        data: {
          productId: ing.resaleProductId,
          type: StockMovementType.PURCHASE,
          quantity: created.quantity,
          workspaceId,
        },
      });
    }
  }

  revalidatePath("/purchases");
  revalidatePath("/pantry");
  revalidatePath("/products");
  return { ok: true };
}

export async function deletePurchase(id: string): Promise<ActionResult> {
  const { db } = await getScopedDb();
  await assertCanWrite();
  await db.purchase.delete({ where: { id } });
  revalidatePath("/purchases");
  revalidatePath("/pantry");
  return { ok: true };
}

// ─── Preço lembrado (autopreenchimento) ──────────────────────────────────────

export async function fetchLastPriceForSupplierItem(
  supplierId: string | null,
  ingredientId: string,
): Promise<{ quantity: number; unit: BaseUnit; pricePaidCents: number } | null> {
  const { db } = await getScopedDb();
  const last = await getLastPurchase(db, ingredientId, supplierId ?? undefined);
  if (!last) return null;
  return { quantity: last.quantity, unit: last.unit, pricePaidCents: last.pricePaidCents };
}
```

Nota: `createSupplierInline`/`updateSupplier`/`deleteSupplier` usam `getScopedDb()` sem restrição de papel — diferente do `createIngredientForPurchase` (só OWNER/ADMIN). Fornecedor é só um rótulo de baixo risco; qualquer membro com permissão de escrita pode cadastrar um na hora de registrar uma compra, o que é exatamente o ponto de reduzir a burocracia do módulo.

- [ ] **Step 4: Implementar `src/server/queries/purchases.ts`**

```ts
import { getWorkspaceDb } from "@/server/tenant/context";

export type SupplierItem = Awaited<ReturnType<typeof getSuppliers>>[number];

export async function getSuppliers() {
  const db = await getWorkspaceDb();
  return db.supplier.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { purchases: true } } },
  });
}

export type PurchaseListItem = Awaited<ReturnType<typeof getPurchases>>[number];

export async function getPurchases() {
  const db = await getWorkspaceDb();
  return db.purchase.findMany({
    orderBy: { purchasedAt: "desc" },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: { ingredient: { select: { id: true, name: true, baseUnit: true } } },
      },
    },
  });
}
```

- [ ] **Step 5: Rodar os testes**

```bash
pnpm exec vitest run src/server/actions/purchases.test.ts
```

Esperado: todos passando.

- [ ] **Step 6: Apagar os arquivos antigos de mercado**

```bash
git rm src/server/actions/markets.ts src/server/queries/markets.ts
```

(`getLatestPricesByIngredient`, exportada pelo `queries/markets.ts` antigo, nunca foi importada em lugar nenhum do projeto — confirmado antes de escrever este plano — então não precisa de substituto.)

- [ ] **Step 7: Commit**

```bash
git add src/server/actions/purchases.ts src/server/queries/purchases.ts src/server/actions/purchases.test.ts
git commit -m "$(cat <<'EOF'
feat(purchases): compra multi-item com fornecedor opcional e preço lembrado

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Receitas — usar o helper de custo novo

**Files:**
- Modify: `src/server/queries/recipes.ts`

**Interfaces:**
- Consumes: `unitCostFromLastPurchase` (Task 2).
- Produces: mesma API pública (`getRecipesWithCost`, `getRecipeById`, `getIngredientOptions`) — só troca a fonte de dados internamente.

- [ ] **Step 1: Substituir o conteúdo de `src/server/queries/recipes.ts`**

```ts
import { getWorkspaceDb } from "@/server/tenant/context";
import { unitCostFromLastPurchase } from "./purchase-cost";

// ─── Lista com custo estimado ────────────────────────────────────────────────

export type RecipeListItem = Awaited<ReturnType<typeof getRecipesWithCost>>[number];

export async function getRecipesWithCost() {
  const db = await getWorkspaceDb();
  const recipes = await db.recipe.findMany({
    orderBy: { name: "asc" },
    include: {
      ingredients: {
        include: {
          ingredient: {
            include: {
              purchaseItems: {
                orderBy: { purchase: { purchasedAt: "desc" } },
                take: 1,
                select: { quantity: true, pricePaidCents: true },
              },
            },
          },
        },
      },
    },
  });

  return recipes.map((recipe) => {
    let totalCostCents = 0;
    let hasAllCosts = recipe.ingredients.length > 0;

    for (const ri of recipe.ingredients) {
      const lastPurchase = ri.ingredient.purchaseItems[0] ?? null;
      const unitCost = unitCostFromLastPurchase(lastPurchase);
      if (unitCost === null) {
        hasAllCosts = false;
        continue;
      }
      totalCostCents += unitCost * ri.quantity;
    }

    return {
      id: recipe.id,
      name: recipe.name,
      yieldQty: recipe.yieldQty,
      notes: recipe.notes,
      ingredientCount: recipe.ingredients.length,
      totalCostCents: hasAllCosts ? totalCostCents : null,
      costPerUnitCents: hasAllCosts && recipe.yieldQty > 0
        ? totalCostCents / recipe.yieldQty
        : null,
    };
  });
}

// ─── Receita completa para edição ────────────────────────────────────────────

export type RecipeDetail = Awaited<ReturnType<typeof getRecipeById>>;

export async function getRecipeById(id: string) {
  const db = await getWorkspaceDb();
  const recipe = await db.recipe.findUnique({
    where: { id },
    include: {
      ingredients: {
        include: {
          ingredient: {
            include: {
              purchaseItems: {
                orderBy: { purchase: { purchasedAt: "desc" } },
                take: 1,
                select: { quantity: true, pricePaidCents: true },
              },
            },
          },
        },
        orderBy: { ingredient: { name: "asc" } },
      },
    },
  });

  if (!recipe) return null;

  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ri) => {
      const last = ri.ingredient.purchaseItems[0] ?? null;
      return {
        ingredientId: ri.ingredientId,
        ingredientName: ri.ingredient.name,
        baseUnit: ri.ingredient.baseUnit,
        quantity: ri.quantity,
        unitCostCents: unitCostFromLastPurchase(last),
      };
    }),
  };
}

// ─── Lista de ingredientes disponíveis (para o select no form) ───────────────

export type IngredientOption = Awaited<ReturnType<typeof getIngredientOptions>>[number];

export async function getIngredientOptions() {
  const db = await getWorkspaceDb();
  const ings = await db.ingredient.findMany({
    orderBy: { name: "asc" },
    include: {
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        select: { quantity: true, pricePaidCents: true },
      },
    },
  });

  return ings.map((ing) => ({
    id: ing.id,
    name: ing.name,
    baseUnit: ing.baseUnit as string,
    unitCostCents: unitCostFromLastPurchase(ing.purchaseItems[0] ?? null),
  }));
}
```

- [ ] **Step 2: Verificar que não há mais nenhuma referência a `ri.ingredient.purchases` neste arquivo**

```bash
grep -n "\.purchases\b" src/server/queries/recipes.ts
```

Esperado: nenhum resultado.

- [ ] **Step 3: Commit**

```bash
git add src/server/queries/recipes.ts
git commit -m "$(cat <<'EOF'
refactor(recipes): usa o helper de custo consolidado em vez de calcular inline

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Despensa — trocar fonte de custo + estoque de revenda

**Files:**
- Modify: `src/server/queries/production.ts`
- Modify: `src/app/(app)/pantry/page.tsx`
- Modify: `src/app/(app)/pantry/shopping-list/page.tsx`

**Interfaces:**
- Consumes: `unitCostFromLastPurchase` (Task 2); `Ingredient.forResale`/`resaleProductId` (Task 3).
- Produces: `PantryEntry` ganha `forResale: boolean`, `resaleSold: number | null` (quantidade vendida do produto vinculado, só quando `forResale`); o campo `latestMarket` é renomeado para `latestSupplier`. `current` de cada insumo passa a descontar também `resaleSold`.

**Atenção:** `getPantryStock()` tem DOIS consumidores no código atual — `src/app/(app)/pantry/page.tsx` e `src/app/(app)/pantry/shopping-list/page.tsx` (este segundo usa `item.latestMarket` na linha 58-59). Os dois precisam ser atualizados nesta task; esquecer o segundo quebra a compilação.

- [ ] **Step 1: Atualizar `getPantryStock` em `src/server/queries/production.ts`**

Substituir a seção `PantryEntry`/`getPantryStock` (a partir de `// ─── Estoque de ingredientes (despensa) ───` até o fim do arquivo) por:

```ts
// ─── Estoque de ingredientes (despensa) ───────────────────────────────────────

export type PantryEntry = {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  purchased: number;
  consumed: number;
  current: number;
  minStock: number | null;
  belowMin: boolean;
  latestPriceCents: number | null; // preço por unidade base (centavos)
  latestSupplier: string | null;
  forResale: boolean;
  resaleSold: number | null; // quantidade vendida do produto vinculado (null se não é revenda)
};

export async function getPantryStock(): Promise<PantryEntry[]> {
  const db = await getWorkspaceDb();
  const ingredients = await db.ingredient.findMany({
    orderBy: { name: "asc" },
    include: {
      purchaseItems: {
        orderBy: { purchase: { purchasedAt: "desc" } },
        take: 1,
        include: { purchase: { select: { supplier: { select: { name: true } } } } },
      },
    },
  });

  // Total comprado por ingrediente
  const purchaseSums = await db.purchaseItem.groupBy({
    by: ["ingredientId"],
    _sum: { quantity: true },
  });
  const purchaseMap = new Map(
    purchaseSums.map((r) => [r.ingredientId, r._sum.quantity ?? 0]),
  );

  // Total consumido em produções (matéria-prima)
  const consumptionMap = await buildConsumptionMap(db);

  // Total vendido diretamente (insumos de revenda), via o mesmo ledger de StockMovement
  // usado por produto acabado: soma apenas os movimentos de venda (tipo SALE).
  const resaleIds = ingredients
    .filter((ing) => ing.forResale && ing.resaleProductId)
    .map((ing) => ing.resaleProductId!);
  const soldMovements = resaleIds.length > 0
    ? await db.stockMovement.groupBy({
        by: ["productId"],
        where: { productId: { in: resaleIds }, type: "SALE" },
        _sum: { quantity: true },
      })
    : [];
  const soldByProductId = new Map(
    soldMovements.map((r) => [r.productId, Math.abs(r._sum.quantity ?? 0)]),
  );

  return ingredients.map((ing) => {
    const purchased = purchaseMap.get(ing.id) ?? 0;
    const consumed = consumptionMap.get(ing.id) ?? 0;
    const resaleSold = ing.forResale && ing.resaleProductId
      ? soldByProductId.get(ing.resaleProductId) ?? 0
      : null;
    const current = purchased - consumed - (resaleSold ?? 0);
    const lastPurchase = ing.purchaseItems[0];
    const pricePerUnit = unitCostFromLastPurchase(lastPurchase ?? null);

    return {
      ingredientId: ing.id,
      ingredientName: ing.name,
      baseUnit: ing.baseUnit,
      purchased,
      consumed,
      current,
      minStock: ing.minStock ?? null,
      belowMin: isLowStock(current, ing.minStock),
      latestPriceCents: pricePerUnit !== null ? Math.round(pricePerUnit) : null,
      latestSupplier: lastPurchase?.purchase.supplier?.name ?? null,
      forResale: ing.forResale,
      resaleSold,
    };
  });
}

/** Constrói mapa ingredientId → quantidade consumida em produções */
async function buildConsumptionMap(db: PrismaClient): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  const batches = await db.productionBatch.findMany({
    where: { recipeId: { not: null } },
    include: {
      recipe: {
        include: { ingredients: true },
      },
      fillings: {
        include: {
          flavor: {
            include: {
              fillingRecipe: { include: { ingredients: true } },
            },
          },
        },
      },
    },
  });

  for (const batch of batches) {
    if (!batch.recipe) continue;
    const yieldQty = batch.recipe.yieldQty || 1;
    // Quantos "lotes de receita" foram feitos
    const batches_count = batch.quantity / yieldQty;

    // Consumo base
    for (const ri of batch.recipe.ingredients) {
      const prev = map.get(ri.ingredientId) ?? 0;
      map.set(ri.ingredientId, prev + ri.quantity * batches_count);
    }

    // Consumo de recheios
    for (const filling of batch.fillings) {
      const fillingRecipe = filling.flavor.fillingRecipe;
      if (!fillingRecipe) continue;
      for (const ri of fillingRecipe.ingredients) {
        const prev = map.get(ri.ingredientId) ?? 0;
        // filling.quantity cookies recheados × ingrediente por cookie
        map.set(ri.ingredientId, prev + ri.quantity * filling.quantity);
      }
    }
  }

  return map;
}
```

Adicionar o import de `unitCostFromLastPurchase` no topo do arquivo (junto aos outros imports):

```ts
import { unitCostFromLastPurchase } from "./purchase-cost";
```

- [ ] **Step 2: Atualizar `src/app/(app)/pantry/page.tsx` para mostrar o consumo de revenda**

No componente `PantryRow`, dentro do `<div className="flex items-center justify-between text-xs text-muted-foreground">` que hoje mostra `↑ comprado` / `↓ usado`, adicionar a linha de vendido quando `forResale`:

Trocar:

```tsx
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex gap-3">
          <span>↑ {purchasedFormatted} comprado</span>
          <span>↓ {consumedFormatted} usado</span>
        </div>
        {entry.latestPriceCents !== null && entry.latestMarket && (
          <span>
            R$ {(entry.latestPriceCents / 100).toFixed(2)}/{unitLabel} · {entry.latestMarket}
          </span>
        )}
      </div>
```

por:

```tsx
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-3">
          <span>↑ {purchasedFormatted} comprado</span>
          {entry.consumed > 0 && <span>↓ {consumedFormatted} usado</span>}
          {entry.forResale && entry.resaleSold != null && entry.resaleSold > 0 && (
            <span>↓ {formatQty(entry.resaleSold, unit)} revendido</span>
          )}
        </div>
        {entry.latestPriceCents !== null && entry.latestSupplier && (
          <span>
            R$ {(entry.latestPriceCents / 100).toFixed(2)}/{unitLabel} · {entry.latestSupplier}
          </span>
        )}
      </div>
      {entry.forResale && (
        <Badge variant="secondary" className="text-xs">Revenda</Badge>
      )}
```

(a última linha usa o mesmo `Badge` já importado no topo do arquivo).

Nesse mesmo arquivo, a mensagem do `EmptyState` (despensa vazia) ainda cita o nome antigo da página. Trocar:

```tsx
          description="Registre compras de ingredientes em Mercados e preços para ver o estoque aqui."
```

por:

```tsx
          description="Registre compras em Compras para ver o estoque aqui."
```

- [ ] **Step 3: Atualizar o segundo consumidor de `getPantryStock` — `src/app/(app)/pantry/shopping-list/page.tsx`**

Trocar:

```tsx
                        {item.latestMarket && item.latestPriceCents != null &&
                          ` · ${formatBRL(item.latestPriceCents)}/${baseUnitLabel(unit)} em ${item.latestMarket}`}
```

por:

```tsx
                        {item.latestSupplier && item.latestPriceCents != null &&
                          ` · ${formatBRL(item.latestPriceCents)}/${baseUnitLabel(unit)} em ${item.latestSupplier}`}
```

- [ ] **Step 4: Rodar o smoke test do projeto para essa área**

```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "production\.ts|pantry/page\.tsx|pantry/shopping-list/page\.tsx"
```

Esperado: nenhuma linha (os únicos erros de tipo esperados neste ponto do plano são em arquivos ainda não tocados — `markets`, `dashboard.ts`, componentes de compra antigos — que serão corrigidos nas próximas tasks).

- [ ] **Step 5: Commit**

```bash
git add src/server/queries/production.ts "src/app/(app)/pantry/page.tsx" "src/app/(app)/pantry/shopping-list/page.tsx"
git commit -m "$(cat <<'EOF'
feat(pantry): despensa mostra estoque de insumos de revenda

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Dashboard — Fornecedor no lugar de Mercado + COGS de revenda

**Files:**
- Modify: `src/server/queries/dashboard.ts`
- Modify: `src/components/dashboard/dashboard-filters.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Rename: `src/components/charts/market-spend-chart.tsx` → `src/components/charts/supplier-spend-chart.tsx`

**Interfaces:**
- Consumes: schema da Task 1 (`Purchase`/`PurchaseItem`/`Supplier`), `Ingredient.resaleProductId` (Task 3).
- Produces: `DashboardFilters.supplierId` (era `marketId`); `DashboardData.kpis.cogsCents` agora soma produção + revenda; `DashboardData.supplier` (era `market`) com `spendBySupplier`/`priceComparison`.

- [ ] **Step 1: Editar `src/server/queries/dashboard.ts` — filtros e opções**

Trocar:

```ts
export type DashboardFilters = {
  from: Date;
  to: Date;
  status: DashboardStatus;
  productId?: string;
  flavorId?: string;
  customerId?: string;
  marketId?: string;
};
```

por:

```ts
export type DashboardFilters = {
  from: Date;
  to: Date;
  status: DashboardStatus;
  productId?: string;
  flavorId?: string;
  customerId?: string;
  supplierId?: string;
};
```

Em `getFilterOptions`, trocar:

```ts
  const markets = await db.market.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return { products, customers, markets };
```

por:

```ts
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return { products, customers, suppliers };
```

- [ ] **Step 2: Editar `getDashboardData` — trocar a fonte de compras**

Trocar (Query 4):

```ts
  // ── Query 4: compras de ingredientes ────────────────────────────────────────
  const purchases = await db.ingredientPurchase.findMany({
    orderBy: { purchasedAt: "desc" },
    select: {
      marketId: true,
      pricePaidCents: true,
      quantity: true,
      purchasedAt: true,
      market: { select: { id: true, name: true } },
      ingredient: { select: { id: true, name: true, baseUnit: true } },
    },
  });
```

por:

```ts
  // ── Query 4: itens de compra ─────────────────────────────────────────────────
  const purchaseItems = await db.purchaseItem.findMany({
    orderBy: { purchase: { purchasedAt: "desc" } },
    select: {
      pricePaidCents: true,
      quantity: true,
      purchase: {
        select: { purchasedAt: true, supplierId: true, supplier: { select: { id: true, name: true } } },
      },
      ingredient: { select: { id: true, name: true, baseUnit: true, forResale: true, resaleProductId: true } },
    },
  });
```

Em seguida, trocar o bloco `costPerBaseUnit`/`purchasedTotal`/`lastPriceByMarket`:

```ts
  // ─── Custo/unidade base (última compra), consumo total ───────────────────────
  const costPerBaseUnit = new Map<string, number>();
  const purchasedTotal = new Map<string, number>();
  const lastPriceByMarket = new Map<string, Map<string, number>>();
  for (const p of purchases) {
    const ingId = p.ingredient.id;
    purchasedTotal.set(ingId, (purchasedTotal.get(ingId) ?? 0) + p.quantity);
    if (p.quantity > 0) {
      if (!costPerBaseUnit.has(ingId)) {
        costPerBaseUnit.set(ingId, p.pricePaidCents / p.quantity);
      }
      let mkt = lastPriceByMarket.get(ingId);
      if (!mkt) { mkt = new Map(); lastPriceByMarket.set(ingId, mkt); }
      if (!mkt.has(p.marketId)) mkt.set(p.marketId, p.pricePaidCents / p.quantity);
    }
  }
```

por:

```ts
  // ─── Custo/unidade base (última compra), consumo total ───────────────────────
  const costPerBaseUnit = new Map<string, number>();
  const purchasedTotal = new Map<string, number>();
  const lastPriceBySupplier = new Map<string, Map<string, number>>();
  const resaleUnitCostByProductId = new Map<string, number>();
  for (const p of purchaseItems) {
    const ingId = p.ingredient.id;
    purchasedTotal.set(ingId, (purchasedTotal.get(ingId) ?? 0) + p.quantity);
    if (p.quantity > 0) {
      const unit = p.pricePaidCents / p.quantity;
      if (!costPerBaseUnit.has(ingId)) costPerBaseUnit.set(ingId, unit);
      if (p.ingredient.forResale && p.ingredient.resaleProductId) {
        if (!resaleUnitCostByProductId.has(p.ingredient.resaleProductId)) {
          resaleUnitCostByProductId.set(p.ingredient.resaleProductId, unit);
        }
      }
      const supplierId = p.purchase.supplierId;
      if (supplierId) {
        let bySupplier = lastPriceBySupplier.get(ingId);
        if (!bySupplier) { bySupplier = new Map(); lastPriceBySupplier.set(ingId, bySupplier); }
        if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, unit);
      }
    }
  }
```

(`purchaseItems` já vem ordenado por `purchase.purchasedAt desc`, então o primeiro valor gravado em cada `Map` continua sendo, como antes, o mais recente — inclusive `resaleUnitCostByProductId`, que alimenta o COGS de revenda no Step 3.)

- [ ] **Step 3: Editar `getDashboardData` — COGS somando produção + revenda**

Trocar:

```ts
  const totalRevenue = paidRevenue + forecastRevenue;
  const avgTicket = salesCount > 0 ? Math.round(totalRevenue / salesCount) : 0;
  const cogs = unitCost != null ? Math.round(unitCost * soldCookies) : null;
  const grossProfit = cogs != null ? paidRevenue - cogs : null;
  const marginPct =
    grossProfit != null && paidRevenue > 0
      ? (grossProfit / paidRevenue) * 100
      : null;
```

por:

```ts
  const totalRevenue = paidRevenue + forecastRevenue;
  const avgTicket = salesCount > 0 ? Math.round(totalRevenue / salesCount) : 0;

  const productionCogs = unitCost != null ? unitCost * soldCookies : 0;
  let resaleCogs = 0;
  for (const sale of sales) {
    const matched = hasItemFilter ? sale.items.filter(itemMatches) : sale.items;
    for (const item of matched) {
      const resaleUnit = resaleUnitCostByProductId.get(item.productId);
      if (resaleUnit == null) continue;
      resaleCogs += resaleUnit * item.quantity;
    }
  }
  const cogs = unitCost != null || resaleCogs > 0
    ? Math.round(productionCogs + resaleCogs)
    : null;
  const grossProfit = cogs != null ? paidRevenue - cogs : null;
  const marginPct =
    grossProfit != null && paidRevenue > 0
      ? (grossProfit / paidRevenue) * 100
      : null;
```

(`resaleUnitCostByProductId` só tem entrada para produtos vinculados a um insumo `forResale`, então `matched` items de produtos "normais" simplesmente não incrementam `resaleCogs`.)

**Correção obrigatória, achada em revisão:** mais acima nesta mesma função, na seção "KPIs + mix + clientes" (antes deste Step 3, já existente no arquivo hoje), `soldCookies` é somado a partir de `saleQty`:

```ts
    const saleQty = matchedItems.reduce((s, i) => s + i.quantity, 0);
```

Esse cálculo soma a quantidade de **todos** os itens vendidos, inclusive os ligados a insumo de revenda — e `productionCogs = unitCost * soldCookies` (Step 3, acima) assume que toda unidade em `soldCookies` é um cookie custeado pela produção. Sem ajuste, uma venda que misture cookie e item de revenda cobra o item de revenda duas vezes: uma via `productionCogs` e outra via `resaleCogs` (que já está correto). Trocar essa linha por:

```ts
    const saleQty = matchedItems.reduce(
      (s, i) => s + (resaleUnitCostByProductId.has(i.productId) ? 0 : i.quantity),
      0,
    );
```

Isso também corrige de quebra o significado do KPI `soldCookies`/"cookies vendidos": um refrigerante revendido nunca foi um cookie, não deveria contar nesse número. Nada mais no loop depende de `saleQty` além dessa soma (o `mixMap`, logo abaixo, usa `i.quantity` direto por item e continua contando itens de revenda normalmente no detalhamento por produto — não mexer nele).

- [ ] **Step 4: Editar a seção final (`Mercado` → `Fornecedor`)**

Trocar:

```ts
  // ─── Mercado ─────────────────────────────────────────────────────────────────
  const spendMap = new Map<string, { name: string; spend: number; count: number }>();
  for (const p of purchases) {
    if (p.purchasedAt < from || p.purchasedAt > to) continue;
    if (filters.marketId && p.marketId !== filters.marketId) continue;
    const e = spendMap.get(p.marketId) ?? { name: p.market.name, spend: 0, count: 0 };
    e.spend += p.pricePaidCents;
    e.count += 1;
    spendMap.set(p.marketId, e);
  }
  const spendByMarket = Array.from(spendMap.values())
    .sort((a, b) => b.spend - a.spend)
    .map((m) => ({ name: m.name, spendCents: m.spend, count: m.count }));
  const totalSpendCents = spendByMarket.reduce((s, m) => s + m.spendCents, 0);

  const marketNameById = new Map(purchases.map((p) => [p.marketId, p.market.name]));
  const ingNameById = new Map(purchases.map((p) => [p.ingredient.id, p.ingredient]));
  const priceComparison = Array.from(lastPriceByMarket.entries())
    .map(([ingId, byMkt]) => {
      const ing = ingNameById.get(ingId);
      if (!ing || byMkt.size < 2) return null;
      const entries = Array.from(byMkt.entries()).sort((a, b) => a[1] - b[1]);
      const [cheapMkt, cheapVal] = entries[0];
      const [dearMkt, dearVal] = entries[entries.length - 1];
      return {
        name: ing.name,
        baseUnit: ing.baseUnit as string,
        cheapestMarket: marketNameById.get(cheapMkt) ?? "—",
        cheapestUnitCents: cheapVal,
        dearestMarket: marketNameById.get(dearMkt) ?? "—",
        dearestUnitCents: dearVal,
        savingsPct: dearVal > 0 ? ((dearVal - cheapVal) / dearVal) * 100 : 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.savingsPct - a.savingsPct);

  return {
    kpis: {
      paidRevenueCents: paidRevenue,
      forecastRevenueCents: forecastRevenue,
      totalRevenueCents: totalRevenue,
      salesCount,
      soldCookies,
      avgTicketCents: avgTicket,
      cogsCents: cogs,
      grossProfitCents: grossProfit,
      marginPct,
      unitCostCents: unitCost != null ? Math.round(unitCost) : null,
    },
    granularity,
    trend,
    mix,
    topCustomers,
    lowStock,
    market: { spendByMarket, totalSpendCents, priceComparison },
  };
}
```

por:

```ts
  // ─── Fornecedor ──────────────────────────────────────────────────────────────
  const spendMap = new Map<string, { name: string; spend: number; count: number }>();
  for (const p of purchaseItems) {
    if (p.purchase.purchasedAt < from || p.purchase.purchasedAt > to) continue;
    const supplierId = p.purchase.supplierId ?? "__none__";
    if (filters.supplierId && supplierId !== filters.supplierId) continue;
    const name = p.purchase.supplier?.name ?? "Sem fornecedor";
    const e = spendMap.get(supplierId) ?? { name, spend: 0, count: 0 };
    e.spend += p.pricePaidCents;
    e.count += 1;
    spendMap.set(supplierId, e);
  }
  const spendBySupplier = Array.from(spendMap.values())
    .sort((a, b) => b.spend - a.spend)
    .map((s) => ({ name: s.name, spendCents: s.spend, count: s.count }));
  const totalSpendCents = spendBySupplier.reduce((s, m) => s + m.spendCents, 0);

  const supplierNameById = new Map(
    purchaseItems
      .filter((p) => p.purchase.supplierId)
      .map((p) => [p.purchase.supplierId as string, p.purchase.supplier!.name]),
  );
  const ingNameById = new Map(purchaseItems.map((p) => [p.ingredient.id, p.ingredient]));
  const priceComparison = Array.from(lastPriceBySupplier.entries())
    .map(([ingId, bySupplier]) => {
      const ing = ingNameById.get(ingId);
      if (!ing || bySupplier.size < 2) return null;
      const entries = Array.from(bySupplier.entries()).sort((a, b) => a[1] - b[1]);
      const [cheapSupplier, cheapVal] = entries[0];
      const [dearSupplier, dearVal] = entries[entries.length - 1];
      return {
        name: ing.name,
        baseUnit: ing.baseUnit as string,
        cheapestSupplier: supplierNameById.get(cheapSupplier) ?? "—",
        cheapestUnitCents: cheapVal,
        dearestSupplier: supplierNameById.get(dearSupplier) ?? "—",
        dearestUnitCents: dearVal,
        savingsPct: dearVal > 0 ? ((dearVal - cheapVal) / dearVal) * 100 : 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.savingsPct - a.savingsPct);

  return {
    kpis: {
      paidRevenueCents: paidRevenue,
      forecastRevenueCents: forecastRevenue,
      totalRevenueCents: totalRevenue,
      salesCount,
      soldCookies,
      avgTicketCents: avgTicket,
      cogsCents: cogs,
      grossProfitCents: grossProfit,
      marginPct,
      unitCostCents: unitCost != null ? Math.round(unitCost) : null,
    },
    granularity,
    trend,
    mix,
    topCustomers,
    lowStock,
    supplier: { spendBySupplier, totalSpendCents, priceComparison },
  };
}
```

- [ ] **Step 5: Renomear o gráfico de gasto por mercado**

```bash
git mv src/components/charts/market-spend-chart.tsx src/components/charts/supplier-spend-chart.tsx
```

Em `src/components/charts/supplier-spend-chart.tsx`, trocar `export function MarketSpendChart` por `export function SupplierSpendChart` (única mudança necessária — o resto do componente já é genérico, recebendo `{name, spendCents, count}[]`).

- [ ] **Step 6: Atualizar `src/components/dashboard/dashboard-filters.tsx`**

Trocar todas as ocorrências de `marketId` por `supplierId` e `markets` por `suppliers` no arquivo (prop `markets: Option[]` vira `suppliers: Option[]`; `current.marketId`/`merged.marketId`/`filters.marketId` viram `current.supplierId`/`merged.supplierId`/`filters.supplierId`; `options.markets` vira `options.suppliers`).

- [ ] **Step 7: Atualizar `src/app/(app)/dashboard/page.tsx`**

Trocar:

```ts
import { MarketSpendChart } from "@/components/charts/market-spend-chart";
```

por:

```ts
import { SupplierSpendChart } from "@/components/charts/supplier-spend-chart";
```

Trocar:

```ts
    marketId: s("marketId"),
```

por:

```ts
    supplierId: s("supplierId"),
```

Trocar:

```tsx
  const { kpis, trend, mix, topCustomers, lowStock, market } = data;
```

por:

```tsx
  const { kpis, trend, mix, topCustomers, lowStock, supplier } = data;
```

Trocar, no objeto de filtros passado pro `getDashboardData`:

```ts
          marketId: filters.marketId,
```

por:

```ts
          supplierId: filters.supplierId,
```

Trocar os usos de exibição:

```tsx
          value={formatBRL(market.totalSpendCents)}
```
```tsx
            {market.spendByMarket.length > 0 ? (
              <MarketSpendChart data={market.spendByMarket} />
```
```tsx
            {market.priceComparison.length === 0 ? (
```
```tsx
                {market.priceComparison.slice(0, 6).map((p) => (
```
```tsx
                        {p.cheapestMarket} ·{" "}
```
```tsx
                      −{p.savingsPct.toFixed(0)}% vs {p.dearestMarket}
```

por, respectivamente:

```tsx
          value={formatBRL(supplier.totalSpendCents)}
```
```tsx
            {supplier.spendBySupplier.length > 0 ? (
              <SupplierSpendChart data={supplier.spendBySupplier} />
```
```tsx
            {supplier.priceComparison.length === 0 ? (
```
```tsx
                {supplier.priceComparison.slice(0, 6).map((p) => (
```
```tsx
                        {p.cheapestSupplier} ·{" "}
```
```tsx
                      −{p.savingsPct.toFixed(0)}% vs {p.dearestSupplier}
```

Também renomear qualquer título de seção visível que diga "Mercado"/"Mercados" nessa página para "Fornecedor"/"Fornecedores" (ex.: cabeçalho da seção de gasto por mercado e da tabela de comparação de preços) — buscar por `Mercado` no arquivo:

```bash
grep -n "Mercado" "src/app/(app)/dashboard/page.tsx"
```

e trocar cada ocorrência de texto visível (não de código) por "Fornecedor(es)".

- [ ] **Step 8: Verificar tipos**

```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "dashboard"
```

Esperado: nenhum erro relacionado a dashboard.

- [ ] **Step 9: Commit**

```bash
git add src/server/queries/dashboard.ts src/components/dashboard/dashboard-filters.tsx "src/app/(app)/dashboard/page.tsx" src/components/charts/supplier-spend-chart.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): renomeia mercado para fornecedor e soma COGS de revenda ao lucro

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: UI — Insumo: toggle matéria-prima/revenda no cadastro

**Files:**
- Modify: `src/components/ingredients/ingredient-dialog.tsx`
- Modify: `src/app/(app)/admin/ingredients/page.tsx`

**Interfaces:**
- Consumes: `createIngredient`/`updateIngredient` (Task 3), `getIngredientsWithLastCost` (Task 3).

- [ ] **Step 1: Editar `src/components/ingredients/ingredient-dialog.tsx`**

Trocar a interface `Ingredient` e o corpo do componente. Substituir:

```tsx
interface Ingredient {
  id: string;
  name: string;
  baseUnit: string;
  minStock: number | null;
}
```

por:

```tsx
interface Ingredient {
  id: string;
  name: string;
  baseUnit: string;
  minStock: number | null;
  isRawMaterial: boolean;
  forResale: boolean;
}
```

No componente, adicionar estado dos dois flags (logo abaixo de `const [baseUnit, setBaseUnit] = useState(...)`):

```tsx
  const [isRawMaterial, setIsRawMaterial] = useState(ingredient?.isRawMaterial ?? true);
  const [forResale, setForResale] = useState(ingredient?.forResale ?? false);
```

Em `handleSubmit`, antes de `startTransition`, adicionar:

```tsx
    formData.set("isRawMaterial", isRawMaterial ? "on" : "off");
    formData.set("forResale", forResale ? "on" : "off");
```

Importar `Switch` (`@/components/ui/switch`, já usado em outras telas do projeto — confirmar em `package.json`: `@radix-ui/react-switch` já é dependência) e adicionar, depois do campo "Estoque mínimo" e antes do `DialogFooter`:

```tsx
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="ing-raw">Matéria-prima</Label>
                <p className="text-xs text-muted-foreground">Entra em receitas e produção.</p>
              </div>
              <Switch id="ing-raw" checked={isRawMaterial} onCheckedChange={setIsRawMaterial} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="ing-resale">Revenda</Label>
                <p className="text-xs text-muted-foreground">Vira um produto vendável no Catálogo.</p>
              </div>
              <Switch id="ing-resale" checked={forResale} onCheckedChange={setForResale} />
            </div>
            {!isRawMaterial && !forResale && (
              <p className="text-xs text-destructive">Marque ao menos uma das duas opções.</p>
            )}
          </div>
```

E no botão de submit, desabilitar quando nenhum dos dois estiver marcado:

```tsx
            <Button type="submit" disabled={pending || (!isRawMaterial && !forResale)}>
```

- [ ] **Step 2: Editar `src/app/(app)/admin/ingredients/page.tsx`**

Adicionar um badge "Revenda" ao lado do badge de unidade, e passar os novos campos pro `IngredientDialog` de edição. Trocar:

```tsx
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{ing.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {abbr}
                    </Badge>
                  </div>
```

por:

```tsx
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{ing.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {abbr}
                    </Badge>
                    {ing.forResale && (
                      <Badge variant="secondary" className="text-xs">
                        Revenda
                      </Badge>
                    )}
                  </div>
```

E trocar:

```tsx
                  <IngredientDialog
                    mode="edit"
                    ingredient={{
                      id: ing.id,
                      name: ing.name,
                      baseUnit: ing.baseUnit,
                      minStock: ing.minStock,
                    }}
                  />
```

por:

```tsx
                  <IngredientDialog
                    mode="edit"
                    ingredient={{
                      id: ing.id,
                      name: ing.name,
                      baseUnit: ing.baseUnit,
                      minStock: ing.minStock,
                      isRawMaterial: ing.isRawMaterial,
                      forResale: ing.forResale,
                    }}
                  />
```

- [ ] **Step 3: Verificar tipos**

```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ingredient-dialog|admin/ingredients"
```

Esperado: nenhum erro.

- [ ] **Step 4: Commit**

```bash
git add src/components/ingredients/ingredient-dialog.tsx "src/app/(app)/admin/ingredients/page.tsx"
git commit -m "$(cat <<'EOF'
feat(ingredients): toggle matéria-prima/revenda no formulário de cadastro

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: UI — Fornecedor: combobox com criação inline + lista simples

**Files:**
- Create: `src/components/purchases/supplier-combobox.tsx`
- Create: `src/components/purchases/supplier-dialog.tsx`
- Create: `src/components/purchases/suppliers-list.tsx`

**Interfaces:**
- Consumes: `createSupplierInline`, `updateSupplier`, `deleteSupplier` (Task 4); `SupplierItem` (Task 4).
- Produces: `SupplierCombobox` (props: `value: {id,name}|null`, `onChange`, `options: {id,name}[]`, `onOptionCreated`) — usado pela Task 10. `SupplierDialog`/`SuppliersList` — usados pela Task 11.

- [ ] **Step 1: Criar `src/components/purchases/supplier-combobox.tsx`**

Modelado no `IngredientCombobox` de receitas (`src/components/recipes/ingredient-combobox.tsx`), mas sem unidade e sem exclusão de itens já usados:

```tsx
"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createSupplierInline } from "@/server/actions/purchases";
import { toast } from "sonner";

export type SupplierOption = { id: string; name: string };

interface Props {
  value: SupplierOption | null;
  onChange: (v: SupplierOption | null) => void;
  options: SupplierOption[];
  onOptionCreated: (v: SupplierOption) => void;
}

export function SupplierCombobox({ value, onChange, options, onOptionCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, startCreate] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));

  function handleSelect(o: SupplierOption | null) {
    onChange(o);
    setOpen(false);
  }

  function handleCreate() {
    const name = query.trim();
    if (!name) return;
    const fd = new FormData();
    fd.set("name", name);
    startCreate(async () => {
      const res = await createSupplierInline(fd);
      if (res.ok && res.data) {
        toast.success(`"${res.data.name}" criado.`);
        onOptionCreated(res.data);
        onChange(res.data);
        setOpen(false);
      } else {
        toast.error(res.error ?? "Erro ao criar.");
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value ? <span className="truncate">{value.name}</span> : <span className="text-muted-foreground">Fornecedor (opcional)…</span>}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="flex items-center border-b px-3 py-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ou criar fornecedor…"
            className="h-7 border-0 p-0 shadow-none focus-visible:ring-0 text-sm"
          />
        </div>

        <div className="max-h-52 overflow-y-auto">
          {value && (
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left text-muted-foreground"
            >
              Sem fornecedor
            </button>
          )}
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => handleSelect(o)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
            >
              <Check className={cn("size-4 shrink-0", value?.id === o.id ? "opacity-100" : "opacity-0")} />
              <span className="flex-1 truncate">{o.name}</span>
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {query ? `Nenhum resultado para "${query}".` : "Nenhum fornecedor cadastrado."}
            </p>
          )}

          {query.trim() && !filtered.some((o) => o.name.toLowerCase() === query.trim().toLowerCase()) && (
            <div className="border-t px-3 py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Criar &quot;{query.trim()}&quot;
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Criar `src/components/purchases/supplier-dialog.tsx`**

Cópia adaptada de `src/components/markets/market-dialog.tsx`, trocando `market`→`supplier` e as chamadas de action:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { createSupplierInline, updateSupplier } from "@/server/actions/purchases";

interface Props {
  supplier?: { id: string; name: string };
  onCreated?: (supplier: { id: string; name: string }) => void;
}

export function SupplierDialog({ supplier, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const isEdit = !!supplier;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      const res = isEdit
        ? await updateSupplier(supplier.id, fd)
        : await createSupplierInline(fd);

      if (res.ok) {
        toast.success(isEdit ? "Fornecedor atualizado." : "Fornecedor criado.");
        setOpen(false);
        if (!isEdit && res.data) onCreated?.(res.data);
      } else {
        toast.error(res.error ?? "Erro ao salvar.");
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={isEdit ? "ghost" : "default"}
        className={isEdit ? "h-9 w-9 p-0" : ""}
        onClick={() => setOpen(true)}
      >
        {isEdit ? <Pencil className="size-4" /> : <><Plus className="size-4" /> Novo fornecedor</>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier-name">Nome</Label>
              <Input
                id="supplier-name"
                name="name"
                defaultValue={supplier?.name ?? ""}
                placeholder="Ex.: Atacadão"
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando…" : isEdit ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Criar `src/components/purchases/suppliers-list.tsx`**

Cópia adaptada de `src/components/markets/markets-list.tsx`:

```tsx
"use client";

import { useTransition, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { SupplierDialog } from "./supplier-dialog";
import { deleteSupplier } from "@/server/actions/purchases";
import type { SupplierItem } from "@/server/queries/purchases";

export function SuppliersList({ suppliers }: { suppliers: SupplierItem[] }) {
  if (suppliers.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhum fornecedor cadastrado.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {suppliers.map((s) => (
        <SupplierRow key={s.id} supplier={s} />
      ))}
    </div>
  );
}

function SupplierRow({ supplier }: { supplier: SupplierItem }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, startDelete] = useTransition();

  function handleDelete() {
    startDelete(async () => {
      const res = await deleteSupplier(supplier.id);
      if (res.ok) { toast.success("Fornecedor excluído."); setDeleteOpen(false); }
      else toast.error(res.error ?? "Erro ao excluir.");
    });
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium">{supplier.name}</p>
          <p className="text-xs text-muted-foreground">
            {supplier._count.purchases} {supplier._count.purchases === 1 ? "compra" : "compras"} registradas
          </p>
        </div>
        <div className="flex items-center gap-1">
          <SupplierDialog supplier={{ id: supplier.id, name: supplier.name }} />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir fornecedor</DialogTitle>
            <DialogDescription>
              Tem certeza? As compras registradas com este fornecedor não serão excluídas, apenas perdem o vínculo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

(a mensagem de confirmação muda de "todas as compras... também serão excluídas" para "perdem o vínculo", porque `Purchase.supplierId` agora é `onDelete: SetNull`, diferente do antigo `Market`→`IngredientPurchase` que era `onDelete: Cascade`.)

- [ ] **Step 4: Verificar tipos**

```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "components/purchases"
```

Esperado: nenhum erro.

- [ ] **Step 5: Commit**

```bash
git add src/components/purchases/supplier-combobox.tsx src/components/purchases/supplier-dialog.tsx src/components/purchases/suppliers-list.tsx
git commit -m "$(cat <<'EOF'
feat(purchases): componentes de fornecedor (combobox, cadastro, lista)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: UI — Compra: formulário multi-item com autopreenchimento

**Files:**
- Create: `src/components/purchases/ingredient-combobox.tsx`
- Create: `src/components/purchases/purchase-dialog.tsx`
- Create: `src/components/purchases/purchases-list.tsx`

**Interfaces:**
- Consumes: `createIngredientForPurchase` (Task 3); `createPurchase`, `deletePurchase`, `fetchLastPriceForSupplierItem` (Task 4); `SupplierCombobox` (Task 9); `PurchaseListItem` (Task 4).

- [ ] **Step 1: Criar `src/components/purchases/ingredient-combobox.tsx`**

```tsx
"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createIngredientForPurchase } from "@/server/actions/ingredients";
import { toast } from "sonner";

export type PurchaseIngredientOption = {
  id: string;
  name: string;
  baseUnit: string;
  forResale: boolean;
};

function QuickCreateForm({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (ing: PurchaseIngredientOption) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState("G");
  const [isRawMaterial, setIsRawMaterial] = useState(true);
  const [forResale, setForResale] = useState(false);
  const [saving, startSave] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || (!isRawMaterial && !forResale)) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("baseUnit", unit);
    fd.set("isRawMaterial", isRawMaterial ? "on" : "off");
    fd.set("forResale", forResale ? "on" : "off");
    startSave(async () => {
      const res = await createIngredientForPurchase(fd);
      if (res.ok && res.data) {
        toast.success(`"${res.data.name}" criado.`);
        onCreated({
          id: res.data.id,
          name: res.data.name,
          baseUnit: res.data.baseUnit,
          forResale: res.data.forResale,
        });
      } else {
        toast.error(res.error ?? "Erro ao criar.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Novo insumo
      </p>
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Nome *</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            placeholder="Ex.: Refrigerante lata"
          />
        </div>
        <div>
          <Label className="text-xs">Unidade base</Label>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="G">Grama (g)</SelectItem>
              <SelectItem value="ML">Mililitro (ml)</SelectItem>
              <SelectItem value="UN">Unidade (un)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Matéria-prima</Label>
          <Switch checked={isRawMaterial} onCheckedChange={setIsRawMaterial} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Revenda</Label>
          <Switch checked={forResale} onCheckedChange={setForResale} />
        </div>
        {!isRawMaterial && !forResale && (
          <p className="text-xs text-destructive">Marque ao menos uma das duas opções.</p>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          type="submit"
          size="sm"
          className="flex-1"
          disabled={saving || !name.trim() || (!isRawMaterial && !forResale)}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Criar
        </Button>
      </div>
    </form>
  );
}

interface Props {
  value: PurchaseIngredientOption | null;
  onChange: (v: PurchaseIngredientOption) => void;
  options: PurchaseIngredientOption[];
  onOptionCreated: (v: PurchaseIngredientOption) => void;
}

const UNIT_ABBR: Record<string, string> = { G: "g", ML: "ml", UN: "un" };

export function PurchaseIngredientCombobox({ value, onChange, options, onOptionCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setShowCreate(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));

  function handleSelect(o: PurchaseIngredientOption) {
    onChange(o);
    setOpen(false);
  }

  function handleCreated(ing: PurchaseIngredientOption) {
    onOptionCreated(ing);
    onChange(ing);
    setShowCreate(false);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">{value.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                ({UNIT_ABBR[value.baseUnit] ?? value.baseUnit.toLowerCase()})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Insumo…</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {showCreate ? (
          <QuickCreateForm initialName={query} onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
        ) : (
          <>
            <div className="flex items-center border-b px-3 py-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar insumo…"
                className="h-7 border-0 p-0 shadow-none focus-visible:ring-0 text-sm"
              />
            </div>

            <div className="max-h-52 overflow-y-auto">
              {filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handleSelect(o)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                >
                  <Check className={cn("size-4 shrink-0", value?.id === o.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{o.name}</span>
                  {o.forResale && <span className="text-xs text-muted-foreground">revenda</span>}
                </button>
              ))}

              {filtered.length === 0 && (
                <div className="px-3 py-2 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {query ? `Nenhum resultado para "${query}".` : "Nenhum insumo cadastrado."}
                  </p>
                  <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setShowCreate(true)}>
                    <Plus className="size-3.5" />
                    {query ? `Criar "${query}"` : "Criar insumo"}
                  </Button>
                </div>
              )}

              {filtered.length > 0 && (
                <div className="border-t px-3 py-2">
                  <Button type="button" variant="ghost" size="sm" className="w-full gap-1.5 text-xs text-muted-foreground" onClick={() => setShowCreate(true)}>
                    <Plus className="size-3.5" />
                    {query ? `Criar "${query}"` : "Criar novo insumo"}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Criar `src/components/purchases/purchase-dialog.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { MoneyInput } from "@/components/shared/money-input";
import { createPurchase, fetchLastPriceForSupplierItem } from "@/server/actions/purchases";
import { PURCHASE_UNITS, UNIT_LABEL, toDisplayValue, type InputUnit } from "@/lib/units";
import { SupplierCombobox, type SupplierOption } from "./supplier-combobox";
import { PurchaseIngredientCombobox, type PurchaseIngredientOption } from "./ingredient-combobox";

type DraftItem = {
  key: string;
  ingredient: PurchaseIngredientOption | null;
  quantity: string;
  unit: InputUnit;
  priceCents: number;
};

function emptyItem(): DraftItem {
  return { key: crypto.randomUUID(), ingredient: null, quantity: "", unit: "G", priceCents: 0 };
}

interface Props {
  suppliers: SupplierOption[];
  ingredients: PurchaseIngredientOption[];
}

export function PurchaseDialog({ suppliers, ingredients }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [allSuppliers, setAllSuppliers] = useState(suppliers);
  const [allIngredients, setAllIngredients] = useState(ingredients);
  const [supplier, setSupplier] = useState<SupplierOption | null>(null);
  const [purchasedAt, setPurchasedAt] = useState(format(new Date(), "yyyy-MM-dd"));
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);

  function resetForm() {
    setSupplier(null);
    setPurchasedAt(format(new Date(), "yyyy-MM-dd"));
    setItems([emptyItem()]);
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  async function handleIngredientChange(key: string, ing: PurchaseIngredientOption) {
    updateItem(key, { ingredient: ing });
    const last = await fetchLastPriceForSupplierItem(supplier?.id ?? null, ing.id);
    if (!last) return;
    const displayQty = toDisplayValue(last.quantity, last.unit as InputUnit, last.unit);
    updateItem(key, {
      ingredient: ing,
      quantity: String(displayQty),
      unit: last.unit as InputUnit,
      priceCents: last.pricePaidCents,
    });
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.key !== key) : prev));
  }

  const canSubmit =
    items.length > 0 &&
    items.every((i) => i.ingredient && parseFloat(i.quantity) > 0 && i.priceCents > 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const fd = new FormData();
    fd.set("supplierId", supplier?.id ?? "");
    fd.set("purchasedAt", purchasedAt);
    fd.set(
      "items",
      JSON.stringify(
        items.map((i) => ({
          ingredientId: i.ingredient!.id,
          quantity: parseFloat(i.quantity),
          unit: i.unit,
          pricePaidCents: i.priceCents,
        })),
      ),
    );

    startSave(async () => {
      const res = await createPurchase(fd);
      if (res.ok) {
        toast.success("Compra registrada.");
        setOpen(false);
        resetForm();
      } else {
        toast.error(res.error ?? "Erro ao registrar.");
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Registrar compra
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar compra</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Fornecedor</Label>
                <SupplierCombobox
                  value={supplier}
                  onChange={setSupplier}
                  options={allSuppliers}
                  onOptionCreated={(s) => setAllSuppliers((prev) => [...prev, s])}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="purchased-at">Data da compra</Label>
                <Input
                  id="purchased-at"
                  type="date"
                  value={purchasedAt}
                  onChange={(e) => setPurchasedAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.key} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <PurchaseIngredientCombobox
                        value={item.ingredient}
                        onChange={(ing) => handleIngredientChange(item.key, ing)}
                        options={allIngredients}
                        onOptionCreated={(ing) => setAllIngredients((prev) => [...prev, ing])}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => removeItem(item.key)}
                      disabled={items.length === 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      type="number"
                      min="0.001"
                      step="any"
                      placeholder="Qtd."
                      value={item.quantity}
                      onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                    />
                    <Select value={item.unit} onValueChange={(v) => updateItem(item.key, { unit: v as InputUnit })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PURCHASE_UNITS.map((u) => (
                          <SelectItem key={u} value={u}>{UNIT_LABEL[u]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <MoneyInput
                      valueCents={item.priceCents}
                      onChangeCents={(cents) => updateItem(item.key, { priceCents: cents })}
                    />
                  </div>
                </div>
              ))}

              <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={addItem}>
                <Plus className="size-3.5" />
                Adicionar item
              </Button>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || !canSubmit}>
                {saving ? "Salvando…" : "Registrar compra"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Criar `src/components/purchases/purchases-list.tsx`**

Agora cada linha da lista é uma `Purchase` (cabeçalho) com N itens, não mais um item solto:

```tsx
"use client";

import { useTransition } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/money";
import { formatQty, baseUnitLabel } from "@/lib/units";
import { deletePurchase } from "@/server/actions/purchases";
import type { PurchaseListItem } from "@/server/queries/purchases";

export function PurchasesList({ purchases }: { purchases: PurchaseListItem[] }) {
  if (purchases.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhuma compra registrada.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {purchases.map((p) => (
        <PurchaseRow key={p.id} purchase={p} />
      ))}
    </div>
  );
}

function PurchaseRow({ purchase }: { purchase: PurchaseListItem }) {
  const [deleting, startDelete] = useTransition();
  const totalCents = purchase.items.reduce((s, i) => s + i.pricePaidCents, 0);

  function handleDelete() {
    startDelete(async () => {
      const res = await deletePurchase(purchase.id);
      if (!res.ok) toast.error(res.error ?? "Erro ao excluir.");
    });
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {purchase.supplier ? (
            <Badge variant="secondary" className="text-xs">{purchase.supplier.name}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Sem fornecedor</span>
          )}
          <span className="text-xs text-muted-foreground">
            {format(purchase.purchasedAt, "d MMM yyyy", { locale: ptBR })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium tabular-nums">{formatBRL(totalCents)}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        {purchase.items.map((item) => {
          const pricePerUnit = item.quantity > 0 ? (item.pricePaidCents / item.quantity).toFixed(2) : "—";
          const unitLabel = baseUnitLabel(item.ingredient.baseUnit);
          return (
            <div key={item.id} className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground pl-1">
              <span className="text-foreground">{item.ingredient.name}</span>
              <span>{formatQty(item.quantity, item.ingredient.baseUnit)}</span>
              <span className="text-foreground tabular-nums">{formatBRL(item.pricePaidCents)}</span>
              <span className="text-xs">R$ {pricePerUnit}/{unitLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos**

```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "components/purchases"
```

Esperado: nenhum erro.

- [ ] **Step 5: Commit**

```bash
git add src/components/purchases/ingredient-combobox.tsx src/components/purchases/purchase-dialog.tsx src/components/purchases/purchases-list.tsx
git commit -m "$(cat <<'EOF'
feat(purchases): formulário de compra multi-item com autopreenchimento por fornecedor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: UI — Página de Compras + navegação

**Files:**
- Create: `src/app/(app)/purchases/page.tsx`
- Delete: `src/app/(app)/markets/page.tsx`
- Delete: `src/components/markets/` (diretório inteiro: `purchase-dialog.tsx`, `market-dialog.tsx`, `purchases-list.tsx`, `markets-list.tsx`)
- Modify: `src/components/layout/side-nav.tsx`
- Modify: `src/components/layout/bottom-nav.tsx`
- Modify: `src/app/(app)/more/page.tsx`

**Interfaces:**
- Consumes: `getSuppliers`, `getPurchases` (Task 4); `PurchaseDialog`, `PurchasesList`, `SupplierDialog`, `SuppliersList` (Tasks 9, 10).

- [ ] **Step 1: Criar `src/app/(app)/purchases/page.tsx`**

```tsx
import { ShoppingBag } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getSuppliers, getPurchases } from "@/server/queries/purchases";
import { getWorkspaceDb } from "@/server/tenant/context";
import { PurchaseDialog } from "@/components/purchases/purchase-dialog";
import { SupplierDialog } from "@/components/purchases/supplier-dialog";
import { PurchasesList } from "@/components/purchases/purchases-list";
import { SuppliersList } from "@/components/purchases/suppliers-list";

export default async function PurchasesPage() {
  const db = await getWorkspaceDb();

  const [suppliers, purchases, ingredients] = await Promise.all([
    getSuppliers(),
    getPurchases(),
    db.ingredient.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, baseUnit: true, forResale: true },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Compras"
        description="Registre compras de matéria-prima ou itens para revenda."
        action={<PurchaseDialog suppliers={suppliers} ingredients={ingredients} />}
      />

      <Tabs defaultValue="purchases">
        <TabsList className="w-full sm:w-auto mb-4">
          <TabsTrigger value="purchases" className="flex-1 sm:flex-none">
            Compras
            {purchases.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                {purchases.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="flex-1 sm:flex-none">
            Fornecedores
            {suppliers.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                {suppliers.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="purchases">
          {purchases.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="Nenhuma compra registrada"
              description={
                ingredients.length === 0
                  ? "Registre sua primeira compra — você pode criar o insumo direto no formulário."
                  : "Registre sua primeira compra para calcular o custo das receitas e o lucro de itens revendidos."
              }
              action={<PurchaseDialog suppliers={suppliers} ingredients={ingredients} />}
            />
          ) : (
            <PurchasesList purchases={purchases} />
          )}
        </TabsContent>

        <TabsContent value="suppliers">
          <div className="flex justify-end mb-3">
            <SupplierDialog />
          </div>
          <SuppliersList suppliers={suppliers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

Note que o `canRegister`/bloqueio do formulário até ter mercado+ingrediente cadastrado (existente na página antiga) **não existe mais** — o botão "Registrar compra" aparece sempre, porque fornecedor é opcional e insumo é criado inline no próprio formulário.

- [ ] **Step 2: Apagar os arquivos antigos**

```bash
git rm -r "src/app/(app)/markets" src/components/markets
```

- [ ] **Step 3: Atualizar `src/components/layout/side-nav.tsx`**

Trocar o import de `Store` para incluir `ShoppingBag` (mantendo `Store`, que também é usado por outros componentes de navegação, mas não é mais necessário *neste* arquivo — confirmar se `Store` é usado em outro lugar de `side-nav.tsx` antes de decidir remover o import; neste arquivo ele só era usado no item de menu que estamos trocando, então remover `Store` da lista de imports e adicionar `ShoppingBag`):

```tsx
import {
  LayoutDashboard,
  ShoppingCart,
  ShoppingBag,
  Cookie,
  UtensilsCrossed,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Users,
  Building2,
  type LucideIcon,
} from "lucide-react";
```

Trocar:

```tsx
  { href: "/markets", label: "Mercados e preços", icon: Store },
```

por:

```tsx
  { href: "/purchases", label: "Compras", icon: ShoppingBag },
```

- [ ] **Step 4: Atualizar `src/components/layout/bottom-nav.tsx`**

Trocar:

```tsx
    extraPrefixes: ["/products", "/pantry", "/markets", "/admin", "/workspaces"],
```

por:

```tsx
    extraPrefixes: ["/products", "/pantry", "/purchases", "/admin", "/workspaces"],
```

- [ ] **Step 5: Atualizar `src/app/(app)/more/page.tsx`**

`Store` continua sendo usado neste arquivo (label "Workspace", linha ~108), então mantê-lo importado e adicionar `ShoppingBag`:

```tsx
import {
  Building2,
  ChevronRight,
  Cookie,
  Palette,
  Settings,
  ShoppingBag,
  Store,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
```

Trocar:

```tsx
    {
      href: "/markets",
      label: "Mercados e preços",
      description: "Compras e custo de ingredientes",
      icon: Store,
    },
```

por:

```tsx
    {
      href: "/purchases",
      label: "Compras",
      description: "Compras de matéria-prima e itens de revenda",
      icon: ShoppingBag,
    },
```

- [ ] **Step 6: Verificar tipos e rodar toda a suíte de testes**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
```

Esperado: nenhum erro em nenhum arquivo (esta é a primeira vez no plano em que o projeto inteiro deve compilar).

```bash
pnpm test
```

Esperado: todos os testes passam, **exceto** `src/server/actions/shopping-list.test.ts` (ainda referencia `testDb.market`/`testDb.ingredientPurchase` — corrigido na Task 12).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/purchases" src/components/layout/side-nav.tsx src/components/layout/bottom-nav.tsx "src/app/(app)/more/page.tsx"
git commit -m "$(cat <<'EOF'
feat(purchases): página de Compras substitui Mercados e preços na navegação

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Ajustar teste existente que usava `market`/`ingredientPurchase`

**Files:**
- Modify: `src/server/actions/shopping-list.test.ts`

**Interfaces:**
- Consumes: modelos `Supplier`/`Purchase`/`PurchaseItem` (Task 1).

- [ ] **Step 1: Atualizar os dois testes que criam uma compra**

Em `src/server/actions/shopping-list.test.ts`, trocar (primeiro teste, "cria um item por ingrediente abaixo do mínimo..."):

```ts
    const market = await testDb.market.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    await testDb.ingredientPurchase.create({
      data: {
        ingredientId: ingredient.id,
        marketId: market.id,
        workspaceId: workspace.id,
        quantity: 400,
        unit: "G",
        pricePaidCents: 800,
      },
    });
```

por:

```ts
    const supplier = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    const purchase = await testDb.purchase.create({
      data: { supplierId: supplier.id, workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: {
        ingredientId: ingredient.id,
        purchaseId: purchase.id,
        workspaceId: workspace.id,
        quantity: 400,
        unit: "G",
        pricePaidCents: 800,
      },
    });
```

E no segundo teste ("na segunda chamada atualiza o item existente..."), trocar:

```ts
    const market = await testDb.market.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    await testDb.ingredientPurchase.create({
      data: {
        ingredientId: ingredient.id, marketId: market.id, workspaceId: workspace.id,
        quantity: 200, unit: "G", pricePaidCents: 400,
      },
    });
```

por:

```ts
    const supplier = await testDb.supplier.create({
      data: { name: "Atacadão", workspaceId: workspace.id },
    });
    const purchase = await testDb.purchase.create({
      data: { supplierId: supplier.id, workspaceId: workspace.id },
    });
    await testDb.purchaseItem.create({
      data: {
        ingredientId: ingredient.id, purchaseId: purchase.id, workspaceId: workspace.id,
        quantity: 200, unit: "G", pricePaidCents: 400,
      },
    });
```

- [ ] **Step 2: Rodar o teste**

```bash
pnpm exec vitest run src/server/actions/shopping-list.test.ts
```

Esperado: todos passando.

- [ ] **Step 3: Rodar a suíte inteira e o type-check como verificação final do plano**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm test
```

Esperado: zero erros de tipo, todos os testes verdes.

- [ ] **Step 4: Commit**

```bash
git add src/server/actions/shopping-list.test.ts
git commit -m "$(cat <<'EOF'
test(shopping-list): atualiza fixtures para o novo schema de fornecedor/compra

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação manual sugerida (fora do escopo dos testes automatizados)

Depois da Task 11, com o dev server rodando (`pnpm dev`):

1. Ir em **Compras** (antes "Mercados e preços") com uma conta sem nenhum insumo/fornecedor cadastrado — confirmar que o botão "Registrar compra" já aparece, sem exigir cadastro prévio.
2. Registrar uma compra criando um insumo novo inline como matéria-prima (ex.: "Manteiga"), sem escolher fornecedor, com 2 itens na mesma compra.
3. Registrar outra compra criando um insumo novo marcado como revenda (ex.: "Refrigerante") — conferir em **Configurações → Catálogo** que um produto com esse nome foi criado e pode receber preço.
4. Registrar uma venda desse produto de revenda em **Vendas**, depois conferir em **Painel** que o lucro bruto desconta o custo da última compra daquele insumo.
5. Conferir em **Despensa** que o insumo de revenda mostra "revendido" ao lado de "comprado".
6. Escolher o mesmo fornecedor numa segunda compra do mesmo insumo e confirmar que quantidade/preço vêm pré-preenchidos com os valores da compra anterior.
