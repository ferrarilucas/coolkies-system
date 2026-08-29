# Fundação Multi-tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao app um `workspaceId` em todas as tabelas de domínio e uma camada de acesso que injeta esse escopo automaticamente, migrando os dados de produção para o workspace Douce Vie.

**Architecture:** cada tabela de domínio ganha `workspaceId`. Nenhum código de domínio escreve esse filtro à mão: uma Prisma Client Extension o injeta em toda operação, incluindo escritas aninhadas. A migração acontece em três etapas — coluna nullable, backfill verificado, aperto para `NOT NULL` — para não quebrar a base em uso.

**Tech Stack:** Next.js 15 (App Router), Prisma 6, PostgreSQL 16, TypeScript strict, Vitest, npm.

**Spec:** `docs/superpowers/specs/2026-08-29-multi-tenant-workspaces-design.md`

## Global Constraints

- Código (variáveis, rotas, pastas) em **inglês**; conteúdo de UI em **português**
- **Nunca escrever comentários no código** — regra do projeto, vale para todo arquivo criado ou modificado aqui
- Dinheiro sempre em **centavos (Int)**; formatação BRL só na borda da UI
- Migrations rodam pela `DIRECT_URL` (porta 5432), **nunca** pelo pooler
- Gerenciador de pacotes: **npm** (o README é a fonte; ignore os lockfiles de yarn/pnpm presentes)
- Este plano cobre as fases 1 a 3 do spec. Workspaces/convites e billing são planos separados.
- Ao fim deste plano o app continua com **um único tenant** e o comportamento visível para o usuário é idêntico ao de hoje

## File Structure

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `vitest.config.ts` | configuração de teste, alias `@/` |
| `src/test/db.ts` | client de teste, reset entre testes, factories de workspace |
| `src/server/tenant/nested-writes.ts` | walker DMMF que injeta `workspaceId` em escritas aninhadas |
| `src/server/tenant/extension.ts` | Prisma Client Extension que aplica o escopo |
| `src/server/tenant/context.ts` | `getWorkspaceContext()` e `getWorkspaceDb()` |
| `src/server/tenant/extension.test.ts` | testes de isolamento |
| `scripts/backfill-workspace.ts` | cria Douce Vie e preenche `workspaceId` |
| `scripts/verify-backfill.ts` | falha se sobrar `workspaceId IS NULL` |

**Modificados:** `prisma/schema.prisma`, `package.json`, `eslint.config.mjs`, e os 16 arquivos de `src/server/queries/` e `src/server/actions/`.

A pasta `src/server/tenant/` existe para manter junto o que muda junto: extension, walker e contexto são um único assunto.

---

## Fase 1 — Fundação de dados

### Task 1: Infraestrutura de testes

O projeto não tem testes. Esta task existe para que a extension possa ser desenvolvida por TDD nas tasks seguintes.

O banco de teste é um **database separado no mesmo Postgres do docker-compose**, chamado `cookies_test`. Não é o banco de desenvolvimento: os testes apagam dados entre casos.

**Files:**
- Create: `vitest.config.ts`, `src/test/db.ts`, `src/test/smoke.test.ts`
- Modify: `package.json`, `.env.example`

**Interfaces:**
- Consumes: nada
- Produces: `testDb: PrismaClient` e `resetDb(): Promise<void>` — usados por todos os testes seguintes. A factory `createWorkspace` entra na Task 2, depois que o model existir.

- [ ] **Step 1: Instalar dependências de teste**

```bash
npm install -D vitest@^2 vite-tsconfig-paths@^5 dotenv@^16
```

- [ ] **Step 2: Criar `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { config } from "dotenv";

config({ path: ".env.test" });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 30000,
  },
});
```

`fileParallelism: false` é obrigatório: os testes compartilham um banco e limpam tabelas entre casos. Rodar arquivos em paralelo produz falhas intermitentes.

- [ ] **Step 3: Criar `.env.test` e registrá-lo no `.gitignore`**

```bash
cat > .env.test <<'EOF'
DATABASE_URL="postgresql://cookies:cookies@localhost:5432/cookies_test"
DIRECT_URL="postgresql://cookies:cookies@localhost:5432/cookies_test"
EOF
echo ".env.test" >> .gitignore
```

Adicione as mesmas duas linhas ao `.env.example`, sob um cabeçalho `# ── Testes ──`, para que outra pessoa saiba que o arquivo é necessário.

- [ ] **Step 4: Adicionar scripts ao `package.json`**

Dentro de `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:db:setup": "docker compose exec -T db psql -U cookies -d postgres -c \"DROP DATABASE IF EXISTS cookies_test\" && docker compose exec -T db psql -U cookies -d postgres -c \"CREATE DATABASE cookies_test\" && dotenv -e .env.test -- prisma db push --skip-generate"
```

Instale o runner de env:

```bash
npm install -D dotenv-cli@^7
```

- [ ] **Step 5: Criar `src/test/db.ts`**

```ts
import { PrismaClient } from "@prisma/client";

export const testDb = new PrismaClient();

const TABLES = [
  "member",
  "invitation",
  "workspace",
  "user",
  "stock_movement",
  "production_filling",
  "production_batch",
  "shopping_list_item",
  "recipe_ingredient",
  "ingredient_purchase",
  "sale_item",
  "sale",
  "price_history",
  "price_list_item",
  "flavor",
  "product",
  "recipe",
  "ingredient",
  "market",
  "customer",
];

export async function resetDb() {
  await testDb.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}
```

`resetDb` limpa também `user`, `workspace`, `member` e `invitation`. Sem isso, um teste que cria usuário com e-mail fixo falha na segunda execução por violação de unique — e a falha aparece como intermitente, que é o pior tipo.

As tabelas `workspace`, `member` e `invitation` ainda não existem neste ponto; o `TRUNCATE` só é executado quando algum teste chamar `resetDb`, e o único teste desta task não chama. A Task 2 as cria antes de qualquer uso.

- [ ] **Step 6: Criar `src/test/smoke.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { testDb } from "./db";

describe("banco de teste", () => {
  it("conecta e responde", async () => {
    const result = await testDb.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    expect(result[0].ok).toBe(1);
  });
});
```

- [ ] **Step 7: Subir o banco e preparar o de teste**

```bash
npm run db:up && npm run test:db:setup
```

- [ ] **Step 8: Rodar o teste**

Run: `npm test`
Expected: PASS — 1 teste passando.

- [ ] **Step 9: Commit**

```bash
git add vitest.config.ts src/test package.json package-lock.json .gitignore .env.example
git commit -m "test: infraestrutura de testes com vitest e banco dedicado"
```

---

### Task 2: Schema — workspaces e coluna nullable (migration 1)

Esta é a migration **aditiva** do spec. Nada quebra: `workspaceId` nasce nullable e o app continua funcionando sem tocá-lo.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration gerada em `prisma/migrations/`
- Test: `src/server/tenant/schema.test.ts`

**Interfaces:**
- Consumes: `testDb`, `resetDb` da Task 1
- Produces: models `Workspace`, `Member`, `Invitation`; enum `MemberRole`; campo `workspaceId: String?` nas 16 tabelas de domínio; factory `createWorkspace(name: string)` em `src/test/db.ts`

- [ ] **Step 0: Adicionar a factory a `src/test/db.ts`**

```ts
let counter = 0;

export async function createWorkspace(name: string) {
  counter += 1;
  return testDb.workspace.create({
    data: { name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${counter}` },
  });
}
```

- [ ] **Step 1: Escrever o teste que falha**

`src/server/tenant/schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";

describe("schema multi-tenant", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria produto vinculado a um workspace", async () => {
    const ws = await createWorkspace("Douce Vie");
    const product = await testDb.product.create({
      data: { name: "Cookie", workspaceId: ws.id },
    });
    expect(product.workspaceId).toBe(ws.id);
  });

  it("permite produto sem workspace enquanto a coluna for nullable", async () => {
    const product = await testDb.product.create({ data: { name: "Brownie" } });
    expect(product.workspaceId).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- schema`
Expected: FAIL — `Property 'workspace' does not exist` ou erro de coluna inexistente.

- [ ] **Step 3: Adicionar os models ao `prisma/schema.prisma`**

Ao fim do bloco de AUTH:

```prisma
enum MemberRole {
  OWNER
  ADMIN
  MEMBER
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  CANCELED
  EXPIRED
}

model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members     Member[]
  invitations Invitation[]

  @@map("workspace")
}

model Member {
  id          String     @id @default(cuid())
  userId      String
  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspaceId String
  workspace   Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  role        MemberRole @default(MEMBER)
  createdAt   DateTime   @default(now())

  @@unique([workspaceId, userId])
  @@map("member")
}

model Invitation {
  id          String           @id @default(cuid())
  email       String
  workspaceId String
  workspace   Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  role        MemberRole       @default(MEMBER)
  tokenHash   String           @unique
  status      InvitationStatus @default(PENDING)
  expiresAt   DateTime
  inviterId   String
  createdAt   DateTime         @default(now())

  @@index([workspaceId, status])
  @@map("invitation")
}
```

Adicione a `User`: `members Member[]`.
Adicione a `Session`: `activeWorkspaceId String?`.

- [ ] **Step 4: Adicionar `workspaceId` nullable às 16 tabelas**

Em cada um destes models — `Product`, `Flavor`, `PriceListItem`, `PriceHistory`, `Customer`, `Sale`, `SaleItem`, `Ingredient`, `Market`, `IngredientPurchase`, `Recipe`, `RecipeIngredient`, `ProductionBatch`, `ProductionFilling`, `StockMovement`, `ShoppingListItem` — acrescente:

```prisma
  workspaceId String?
```

Nesta migration **não** declare a relação nem a foreign key: elas entram na Task 9, junto com o `NOT NULL`. Declarar a relação agora obrigaria o Prisma a exigir o campo em todo create, o que quebraria o app antes do backfill.

- [ ] **Step 5: Gerar a migration**

```bash
npm run db:migrate -- --name add_workspace_models_and_nullable_workspace_id
```

- [ ] **Step 6: Aplicar ao banco de teste e rodar**

```bash
npm run test:db:setup && npm test -- schema
```

Expected: PASS — 2 testes.

- [ ] **Step 7: Verificar que o app ainda sobe**

Run: `npm run build`
Expected: build conclui sem erro. Nenhum código existente referencia `workspaceId`, então nada quebra.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/server/tenant
git commit -m "feat: adiciona models de workspace e workspaceId nullable"
```

---

### Task 3: Extension — escopo nas operações simples

**Files:**
- Create: `src/server/tenant/extension.ts`, `src/server/tenant/extension.test.ts`

**Interfaces:**
- Consumes: `testDb`, `createWorkspace`, `resetDb`
- Produces: `scopedDb(workspaceId: string): PrismaClient` — client com escopo aplicado. Tasks 4 e 5 estendem este mesmo arquivo.

- [ ] **Step 1: Escrever os testes que falham**

`src/server/tenant/extension.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";
import { scopedDb } from "./extension";

describe("escopo por workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("findMany não enxerga dados de outro workspace", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    await testDb.product.create({ data: { name: "Cookie A", workspaceId: a.id } });
    await testDb.product.create({ data: { name: "Cookie B", workspaceId: b.id } });

    const found = await scopedDb(a.id).product.findMany();

    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Cookie A");
  });

  it("create grava o workspaceId sem que o chamador informe", async () => {
    const a = await createWorkspace("A");
    const created = await scopedDb(a.id).product.create({ data: { name: "Cookie" } });
    expect(created.workspaceId).toBe(a.id);
  });

  it("deleteMany não atinge outro workspace", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    await testDb.product.create({ data: { name: "X", workspaceId: a.id } });
    await testDb.product.create({ data: { name: "X", workspaceId: b.id } });

    await scopedDb(a.id).product.deleteMany({});

    const remaining = await testDb.product.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].workspaceId).toBe(b.id);
  });

  it("count respeita o escopo", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    await testDb.product.create({ data: { name: "X", workspaceId: a.id } });
    await testDb.product.create({ data: { name: "Y", workspaceId: b.id } });

    expect(await scopedDb(a.id).product.count()).toBe(1);
  });

  it("upsert respeita o escopo no create e no update", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    const alheio = await testDb.product.create({
      data: { name: "Alheio", workspaceId: b.id },
    });

    const criado = await scopedDb(a.id).product.upsert({
      where: { id: alheio.id },
      create: { name: "Novo" },
      update: { name: "Sequestrado" },
    });

    expect(criado.workspaceId).toBe(a.id);
    expect(criado.id).not.toBe(alheio.id);

    const intacto = await testDb.product.findUnique({ where: { id: alheio.id } });
    expect(intacto?.name).toBe("Alheio");
  });

  it("update não atinge linha de outro workspace", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    const alheio = await testDb.product.create({
      data: { name: "Alheio", workspaceId: b.id },
    });

    await expect(
      scopedDb(a.id).product.update({
        where: { id: alheio.id },
        data: { name: "Sequestrado" },
      }),
    ).rejects.toThrow();
  });

  it("não toca modelos de autenticação", async () => {
    const a = await createWorkspace("A");
    const all = await scopedDb(a.id).workspace.findMany();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- extension`
Expected: FAIL — `Cannot find module './extension'`.

- [ ] **Step 3: Implementar `src/server/tenant/extension.ts`**

```ts
import { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

const UNSCOPED_MODELS = new Set([
  "User",
  "Session",
  "Account",
  "Verification",
  "Workspace",
  "Member",
  "Invitation",
]);

const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

const CREATE_OPS = new Set(["create", "createMany"]);
const SINGLE_TARGET_OPS = new Set(["update", "delete"]);

function withWhere(args: Record<string, unknown>, workspaceId: string) {
  const where = (args.where ?? {}) as Record<string, unknown>;
  return { ...args, where: { ...where, workspaceId } };
}

export function scopedDb(workspaceId: string): PrismaClient {
  return db.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (UNSCOPED_MODELS.has(model)) return query(args);

          const typed = (args ?? {}) as Record<string, unknown>;

          if (WHERE_OPS.has(operation) || SINGLE_TARGET_OPS.has(operation)) {
            return query(withWhere(typed, workspaceId));
          }

          if (CREATE_OPS.has(operation)) {
            if (operation === "createMany") {
              const data = typed.data;
              const rows = Array.isArray(data) ? data : [data];
              return query({
                ...typed,
                data: rows.map((row) => ({ ...(row as object), workspaceId })),
              });
            }
            return query({
              ...typed,
              data: { ...((typed.data ?? {}) as object), workspaceId },
            });
          }

          if (operation === "upsert") {
            return query({
              ...withWhere(typed, workspaceId),
              create: { ...((typed.create ?? {}) as object), workspaceId },
            });
          }

          return query(typed);
        },
      },
    },
  }) as unknown as PrismaClient;
}
```

`update` e `delete` recebem `workspaceId` no `where` junto da chave única. O Prisma 6 aceita campos não-únicos no `where` de `update`/`delete` desde que haja um único identificador presente — é o mecanismo que impede atualizar linha de outro tenant.

- [ ] **Step 4: Rodar os testes**

Run: `npm test -- extension`
Expected: PASS — 7 testes.

- [ ] **Step 5: Commit**

```bash
git add src/server/tenant
git commit -m "feat: extension de escopo por workspace nas operacoes simples"
```

---

### Task 4: Extension — `findUnique` reescrito para `findFirst`

Sem isto, `findUnique({ where: { id } })` lê linha de qualquer tenant. O Prisma recusa campo não-único no `where` de `findUnique`, então a operação precisa ser trocada, não filtrada.

**Files:**
- Modify: `src/server/tenant/extension.ts`
- Modify: `src/server/tenant/extension.test.ts`

**Interfaces:**
- Consumes: `scopedDb` da Task 3
- Produces: mesma assinatura; `findUnique` e `findUniqueOrThrow` passam a respeitar escopo

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao `describe` existente:

```ts
  it("findUnique não retorna linha de outro workspace", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");
    const alheio = await testDb.product.create({
      data: { name: "Alheio", workspaceId: b.id },
    });

    const found = await scopedDb(a.id).product.findUnique({ where: { id: alheio.id } });

    expect(found).toBeNull();
  });

  it("findUnique retorna a linha do próprio workspace", async () => {
    const a = await createWorkspace("A");
    const meu = await testDb.product.create({ data: { name: "Meu", workspaceId: a.id } });

    const found = await scopedDb(a.id).product.findUnique({ where: { id: meu.id } });

    expect(found?.id).toBe(meu.id);
  });
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- extension`
Expected: FAIL no primeiro teste novo — retorna o produto de B em vez de `null`.

- [ ] **Step 3: Adicionar a camada `model` à extension**

Em `src/server/tenant/extension.ts`, dentro do `db.$extends({ ... })`, acrescente antes de `query`:

```ts
    model: {
      $allModels: {
        async findUnique(this: unknown, args: Record<string, unknown>) {
          const ctx = Prisma.getExtensionContext(this) as {
            findFirst: (a: unknown) => Promise<unknown>;
          };
          return ctx.findFirst(args);
        },
        async findUniqueOrThrow(this: unknown, args: Record<string, unknown>) {
          const ctx = Prisma.getExtensionContext(this) as {
            findFirstOrThrow: (a: unknown) => Promise<unknown>;
          };
          return ctx.findFirstOrThrow(args);
        },
      },
    },
```

A troca acontece antes do `query`, então o `$allOperations` recebe a operação já como `findFirst` e injeta o `workspaceId` normalmente. Modelos de auth continuam livres porque o `$allOperations` os ignora.

- [ ] **Step 4: Rodar os testes**

Run: `npm test -- extension`
Expected: PASS — 9 testes.

- [ ] **Step 5: Commit**

```bash
git add src/server/tenant
git commit -m "feat: findUnique passa a respeitar o escopo de workspace"
```

---

### Task 5: Extension — escritas aninhadas

`createSale` em `src/server/actions/sales.ts:88` cria `SaleItem` aninhados. Sem esta task, esses filhos nascem sem `workspaceId` e a Task 9 falha ao tornar a coluna obrigatória.

**Files:**
- Create: `src/server/tenant/nested-writes.ts`, `src/server/tenant/nested-writes.test.ts`
- Modify: `src/server/tenant/extension.ts`

**Interfaces:**
- Consumes: `Prisma.dmmf`
- Produces: `injectWorkspaceId(modelName: string, data: unknown, workspaceId: string): unknown` — retorna cópia com `workspaceId` em todo nível

- [ ] **Step 1: Escrever o teste unitário que falha**

`src/server/tenant/nested-writes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { injectWorkspaceId } from "./nested-writes";

describe("injectWorkspaceId", () => {
  it("injeta no nível de topo", () => {
    const result = injectWorkspaceId("Product", { name: "Cookie" }, "ws1") as Record<string, unknown>;
    expect(result.workspaceId).toBe("ws1");
  });

  it("injeta em create aninhado", () => {
    const result = injectWorkspaceId(
      "Sale",
      { totalCents: 100, items: { create: [{ quantity: 2, productNameSnapshot: "Cookie" }] } },
      "ws1",
    ) as { workspaceId: string; items: { create: Array<{ workspaceId: string }> } };

    expect(result.workspaceId).toBe("ws1");
    expect(result.items.create[0].workspaceId).toBe("ws1");
  });

  it("injeta em create aninhado que é objeto, não array", () => {
    const result = injectWorkspaceId(
      "Sale",
      { totalCents: 100, items: { create: { quantity: 1, productNameSnapshot: "X" } } },
      "ws1",
    ) as { items: { create: { workspaceId: string } } };

    expect(result.items.create.workspaceId).toBe("ws1");
  });

  it("injeta em connectOrCreate", () => {
    const result = injectWorkspaceId(
      "Sale",
      { customer: { connectOrCreate: { where: { id: "c1" }, create: { name: "Ana" } } } },
      "ws1",
    ) as { customer: { connectOrCreate: { create: { workspaceId: string } } } };

    expect(result.customer.connectOrCreate.create.workspaceId).toBe("ws1");
  });

  it("não toca connect", () => {
    const result = injectWorkspaceId(
      "Sale",
      { customer: { connect: { id: "c1" } } },
      "ws1",
    ) as { customer: { connect: Record<string, unknown> } };

    expect(result.customer.connect.workspaceId).toBeUndefined();
  });

  it("não injeta em relação para modelo não escopado", () => {
    const result = injectWorkspaceId(
      "Sale",
      { user: { connect: { id: "u1" } } },
      "ws1",
    ) as { user: { connect: Record<string, unknown> } };

    expect(result.user.connect.workspaceId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- nested-writes`
Expected: FAIL — `Cannot find module './nested-writes'`.

- [ ] **Step 3: Implementar `src/server/tenant/nested-writes.ts`**

```ts
import { Prisma } from "@prisma/client";

const UNSCOPED_MODELS = new Set([
  "User",
  "Session",
  "Account",
  "Verification",
  "Workspace",
  "Member",
  "Invitation",
]);

const relationTargets = new Map<string, Map<string, string>>();

for (const model of Prisma.dmmf.datamodel.models) {
  const relations = new Map<string, string>();
  for (const field of model.fields) {
    if (field.kind === "object") relations.set(field.name, field.type);
  }
  relationTargets.set(model.name, relations);
}

const NESTED_CREATE_KEYS = ["create", "createMany"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function injectIntoPayload(model: string, payload: unknown, workspaceId: string): unknown {
  if (Array.isArray(payload)) {
    return payload.map((entry) => injectIntoPayload(model, entry, workspaceId));
  }
  if (!isPlainObject(payload)) return payload;
  return injectWorkspaceId(model, payload, workspaceId);
}

export function injectWorkspaceId(
  modelName: string,
  data: unknown,
  workspaceId: string,
): unknown {
  if (!isPlainObject(data)) return data;

  const relations = relationTargets.get(modelName) ?? new Map<string, string>();
  const result: Record<string, unknown> = { ...data };

  if (!UNSCOPED_MODELS.has(modelName)) result.workspaceId = workspaceId;

  for (const [key, value] of Object.entries(data)) {
    const target = relations.get(key);
    if (!target || UNSCOPED_MODELS.has(target) || !isPlainObject(value)) continue;

    const nested: Record<string, unknown> = { ...value };

    for (const createKey of NESTED_CREATE_KEYS) {
      const payload = nested[createKey];
      if (payload === undefined) continue;
      if (createKey === "createMany" && isPlainObject(payload)) {
        nested[createKey] = {
          ...payload,
          data: injectIntoPayload(target, payload.data, workspaceId),
        };
      } else {
        nested[createKey] = injectIntoPayload(target, payload, workspaceId);
      }
    }

    if (isPlainObject(nested.connectOrCreate)) {
      const coc = nested.connectOrCreate as Record<string, unknown>;
      nested.connectOrCreate = {
        ...coc,
        create: injectIntoPayload(target, coc.create, workspaceId),
      };
    } else if (Array.isArray(nested.connectOrCreate)) {
      nested.connectOrCreate = nested.connectOrCreate.map((entry) => {
        if (!isPlainObject(entry)) return entry;
        return { ...entry, create: injectIntoPayload(target, entry.create, workspaceId) };
      });
    }

    result[key] = nested;
  }

  return result;
}
```

- [ ] **Step 4: Rodar os testes unitários**

Run: `npm test -- nested-writes`
Expected: PASS — 6 testes.

- [ ] **Step 5: Ligar o walker à extension**

Em `src/server/tenant/extension.ts`, importe `injectWorkspaceId` e substitua o bloco `CREATE_OPS` por:

```ts
          if (CREATE_OPS.has(operation)) {
            if (operation === "createMany") {
              const data = typed.data;
              const rows = Array.isArray(data) ? data : [data];
              return query({
                ...typed,
                data: rows.map((row) => ({ ...(row as object), workspaceId })),
              });
            }
            return query({
              ...typed,
              data: injectWorkspaceId(model, typed.data, workspaceId),
            });
          }
```

E no `upsert`, troque `create:` por:

```ts
              create: injectWorkspaceId(model, typed.create, workspaceId),
```

- [ ] **Step 6: Escrever o teste de integração com o caso real**

Acrescente a `src/server/tenant/extension.test.ts`:

```ts
  it("nested write de venda grava workspaceId nos itens", async () => {
    const a = await createWorkspace("A");
    const scoped = scopedDb(a.id);
    const user = await testDb.user.create({
      data: { id: "u-nested", name: "Ana", email: "ana@example.com" },
    });
    const product = await scoped.product.create({ data: { name: "Cookie" } });

    const sale = await scoped.sale.create({
      data: {
        userId: user.id,
        totalCents: 1000,
        items: {
          create: [
            {
              productId: product.id,
              productNameSnapshot: "Cookie",
              quantity: 2,
              unitPriceSnapshot: 500,
            },
          ],
        },
      },
      include: { items: true },
    });

    expect(sale.workspaceId).toBe(a.id);
    expect(sale.items[0].workspaceId).toBe(a.id);
  });
```

- [ ] **Step 7: Rodar tudo**

Run: `npm test`
Expected: PASS — todos os testes.

- [ ] **Step 8: Commit**

```bash
git add src/server/tenant
git commit -m "feat: injeta workspaceId em escritas aninhadas via dmmf"
```

---

### Task 6: Contexto de workspace

**Files:**
- Create: `src/server/tenant/context.ts`

**Interfaces:**
- Consumes: `scopedDb`, `auth` de `@/lib/auth`
- Produces: `getWorkspaceContext(): Promise<{ userId: string; workspaceId: string; role: MemberRole }>` e `getWorkspaceDb(): Promise<PrismaClient>` — usados por todos os arquivos da Fase 3

- [ ] **Step 1: Implementar `src/server/tenant/context.ts`**

```ts
import { headers } from "next/headers";
import type { MemberRole, PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopedDb } from "./extension";

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  role: MemberRole;
};

export async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Não autenticado");

  const membership = await db.member.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new Error("Nenhum workspace disponível");

  return {
    userId: session.user.id,
    workspaceId: membership.workspaceId,
    role: membership.role,
  };
}

export async function getWorkspaceDb(): Promise<PrismaClient> {
  const { workspaceId } = await getWorkspaceContext();
  return scopedDb(workspaceId);
}

export async function requireRole(...allowed: MemberRole[]): Promise<WorkspaceContext> {
  const context = await getWorkspaceContext();
  if (!allowed.includes(context.role)) throw new Error("Não autorizado");
  return context;
}
```

Esta versão resolve o workspace pela primeira associação do usuário, o que é suficiente enquanto existe um único tenant. O plano de workspaces substitui isso pela leitura de `session.activeWorkspaceId`; a assinatura pública não muda, então nenhum consumidor precisa ser reescrito.

- [ ] **Step 2: Verificar a compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/server/tenant/context.ts
git commit -m "feat: contexto de workspace e client escopado"
```

---

## Fase 2 — Backfill Douce Vie

### Task 7: Script de backfill

**Files:**
- Create: `scripts/backfill-workspace.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: models da Task 2
- Produces: script `npm run backfill -- <email-do-owner>`

- [ ] **Step 1: Implementar `scripts/backfill-workspace.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DOMAIN_TABLES = [
  "product",
  "flavor",
  "price_list_item",
  "price_history",
  "customer",
  "sale",
  "sale_item",
  "ingredient",
  "market",
  "ingredient_purchase",
  "recipe",
  "recipe_ingredient",
  "production_batch",
  "production_filling",
  "stock_movement",
  "shopping_list_item",
];

async function main() {
  const ownerEmail = process.argv[2]?.trim().toLowerCase();
  if (!ownerEmail) {
    throw new Error("Uso: npm run backfill -- <email-do-owner>");
  }

  const owner = await db.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    throw new Error(`Nenhum usuário com o e-mail ${ownerEmail}. Backfill abortado.`);
  }

  const existing = await db.workspace.findUnique({ where: { slug: "douce-vie" } });
  if (existing) {
    throw new Error("Workspace douce-vie já existe. Backfill abortado.");
  }

  const workspace = await db.workspace.create({
    data: { name: "Douce Vie", slug: "douce-vie" },
  });

  await db.member.create({
    data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
  });

  const others = await db.user.findMany({ where: { id: { not: owner.id } } });
  if (others.length > 0) {
    await db.member.createMany({
      data: others.map((user) => ({
        userId: user.id,
        workspaceId: workspace.id,
        role: "MEMBER" as const,
      })),
    });
  }

  for (const table of DOMAIN_TABLES) {
    const updated = await db.$executeRawUnsafe(
      `UPDATE "${table}" SET "workspaceId" = $1 WHERE "workspaceId" IS NULL`,
      workspace.id,
    );
    console.log(`${table}: ${updated} linhas`);
  }

  console.log(`\nWorkspace Douce Vie criado: ${workspace.id}`);
  console.log(`Owner: ${owner.email}`);
  console.log(`Membros adicionais: ${others.length}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
```

- [ ] **Step 2: Adicionar o script ao `package.json`**

```json
"backfill": "dotenv -e .env -- tsx scripts/backfill-workspace.ts",
"verify:backfill": "dotenv -e .env -- tsx scripts/verify-backfill.ts"
```

- [ ] **Step 3: Testar contra o banco de desenvolvimento**

```bash
npm run db:seed
npm run backfill -- naoexiste@example.com
```

Expected: falha com "Nenhum usuário com o e-mail naoexiste@example.com. Backfill abortado." e código de saída 1.

- [ ] **Step 4: Rodar com um e-mail válido**

Descubra um e-mail existente e rode:

```bash
npm run db:studio
npm run backfill -- <email-real-do-banco-local>
```

Expected: imprime a contagem de linhas por tabela e o id do workspace.

- [ ] **Step 5: Confirmar idempotência**

Run: `npm run backfill -- <mesmo-email>`
Expected: falha com "Workspace douce-vie já existe. Backfill abortado."

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-workspace.ts package.json
git commit -m "feat: script de backfill do workspace douce vie"
```

---

### Task 8: Script de verificação bloqueante

**Files:**
- Create: `scripts/verify-backfill.ts`

**Interfaces:**
- Consumes: as mesmas 16 tabelas
- Produces: saída 0 se limpo, 1 se houver `workspaceId IS NULL`

- [ ] **Step 1: Implementar `scripts/verify-backfill.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DOMAIN_TABLES = [
  "product",
  "flavor",
  "price_list_item",
  "price_history",
  "customer",
  "sale",
  "sale_item",
  "ingredient",
  "market",
  "ingredient_purchase",
  "recipe",
  "recipe_ingredient",
  "production_batch",
  "production_filling",
  "stock_movement",
  "shopping_list_item",
];

async function main() {
  const offenders: Array<{ table: string; count: number }> = [];

  for (const table of DOMAIN_TABLES) {
    const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint as count FROM "${table}" WHERE "workspaceId" IS NULL`,
    );
    const count = Number(rows[0].count);
    if (count > 0) offenders.push({ table, count });
  }

  if (offenders.length > 0) {
    console.error("Backfill incompleto. Nao rode a migration de aperto.\n");
    for (const { table, count } of offenders) {
      console.error(`  ${table}: ${count} linhas sem workspaceId`);
    }
    process.exit(1);
  }

  console.log(`Backfill verificado: ${DOMAIN_TABLES.length} tabelas sem pendencias.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
```

- [ ] **Step 2: Rodar contra o banco já backfillado**

Run: `npm run verify:backfill`
Expected: "Backfill verificado: 16 tabelas sem pendencias." e saída 0.

- [ ] **Step 3: Provar que o script realmente bloqueia**

```bash
npm run db:studio
```

Crie um produto novo, defina seu `workspaceId` como nulo pelo Studio, e rode:

Run: `npm run verify:backfill`
Expected: saída 1 listando `product: 1 linhas sem workspaceId`.

Depois desfaça: apague o produto de teste e confirme que o script volta a passar. **Um script de verificação que nunca falhou é um script não testado.**

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-backfill.ts
git commit -m "feat: verificacao bloqueante do backfill"
```

---

### Task 9: Migration de aperto

Ponto irreversível. Só rode depois de `npm run verify:backfill` passar.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration gerada

**Interfaces:**
- Consumes: backfill verificado
- Produces: `workspaceId` obrigatório, uniques compostas, índices com `workspaceId` na frente

- [ ] **Step 1: Fazer dump do banco de produção**

```bash
pg_dump "$DIRECT_URL" -Fc -f backup-antes-do-aperto-$(date +%Y%m%d-%H%M).dump
```

Confirme que o arquivo existe e tem tamanho plausível antes de seguir. Não pule este passo.

- [ ] **Step 2: Rodar a verificação**

Run: `npm run verify:backfill`
Expected: saída 0. **Se falhar, pare aqui.**

- [ ] **Step 3: Tornar `workspaceId` obrigatório e declarar a relação**

Em cada uma das 16 tabelas, troque `workspaceId String?` por:

```prisma
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
```

E em `model Workspace`, acrescente o lado inverso de cada relação:

```prisma
  products           Product[]
  flavors            Flavor[]
  priceListItems     PriceListItem[]
  priceHistories     PriceHistory[]
  customers          Customer[]
  sales              Sale[]
  saleItems          SaleItem[]
  ingredients        Ingredient[]
  markets            Market[]
  ingredientPurchases IngredientPurchase[]
  recipes            Recipe[]
  recipeIngredients  RecipeIngredient[]
  productionBatches  ProductionBatch[]
  productionFillings ProductionFilling[]
  stockMovements     StockMovement[]
  shoppingListItems  ShoppingListItem[]
```

- [ ] **Step 4: Trocar as uniques globais por compostas**

| Model | Remover | Adicionar |
|---|---|---|
| `Product` | `@@unique([name])` | `@@unique([workspaceId, name])` |
| `Ingredient` | `@@unique([name])` | `@@unique([workspaceId, name])` |
| `Market` | `@@unique([name])` | `@@unique([workspaceId, name])` |
| `Recipe` | `@@unique([name])` | `@@unique([workspaceId, name])` |
| `Customer` | `@unique` em `email` | `@@unique([workspaceId, email])` |

Em `Customer`, o campo passa a ser `email String?` sem `@unique`, e o bloco ganha `@@unique([workspaceId, email])`.

- [ ] **Step 5: Recriar os índices com `workspaceId` na frente**

| Model | Antes | Depois |
|---|---|---|
| `Sale` | `@@index([soldAt])` | `@@index([workspaceId, soldAt])` |
| `Sale` | `@@index([status, paymentForecastDate])` | `@@index([workspaceId, status, paymentForecastDate])` |
| `StockMovement` | `@@index([productId, flavorId])` | `@@index([workspaceId, productId, flavorId])` |
| `IngredientPurchase` | `@@index([ingredientId, purchasedAt])` | `@@index([workspaceId, ingredientId, purchasedAt])` |

- [ ] **Step 6: Gerar a migration**

```bash
npm run db:migrate -- --name enforce_workspace_scope
```

- [ ] **Step 7: Escrever o teste da unique composta**

Acrescente a `src/server/tenant/extension.test.ts`:

```ts
  it("permite o mesmo nome de produto em workspaces diferentes", async () => {
    const a = await createWorkspace("A");
    const b = await createWorkspace("B");

    await scopedDb(a.id).product.create({ data: { name: "Cookie" } });
    const outro = await scopedDb(b.id).product.create({ data: { name: "Cookie" } });

    expect(outro.name).toBe("Cookie");
  });
```

- [ ] **Step 8: Recriar o banco de teste e rodar**

```bash
npm run test:db:setup && npm test
```

Expected: PASS — todos os testes, incluindo o novo.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/server/tenant
git commit -m "feat: torna workspaceId obrigatorio com uniques e indices compostos"
```

---

## Fase 3 — Camada de acesso

As três tasks seguintes são o mesmo refactor aplicado a módulos diferentes: trocar `import { db } from "@/lib/db"` por `getWorkspaceDb()` obtido dentro de cada função, e trocar `requireAdmin()` por `requireRole("OWNER", "ADMIN")`.

O padrão, em toda função:

```ts
export async function getProductsWithFlavorsAndPrices() {
  const db = await getWorkspaceDb();
  return db.product.findMany({ ... });
}
```

O corpo da query **não muda** — a extension cuida do escopo. O nome local `db` é mantido de propósito para que o diff fique pequeno e revisável.

### Task 10: Catálogo

**Files:**
- Modify: `src/server/queries/catalog.ts`, `src/server/actions/catalog.ts`

**Interfaces:**
- Consumes: `getWorkspaceDb`, `requireRole` da Task 6
- Produces: nenhuma mudança de assinatura pública

- [ ] **Step 1: Migrar `src/server/queries/catalog.ts`**

Remova `import { db } from "@/lib/db"`, acrescente `import { getWorkspaceDb } from "@/server/tenant/context"`, e insira `const db = await getWorkspaceDb();` como primeira linha de `getProductsWithFlavorsAndPrices` e `getPriceHistory`.

- [ ] **Step 2: Migrar `src/server/actions/catalog.ts`**

Substitua a função `requireAdmin` local por:

```ts
import { requireRole } from "@/server/tenant/context";

async function requireAdmin() {
  await requireRole("OWNER", "ADMIN");
}
```

Remova `import { db } from "@/lib/db"` e `import { auth } from "@/lib/auth"`, e acrescente `const db = await getWorkspaceDb();` no início de cada action, depois do `await requireAdmin()`.

- [ ] **Step 3: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificar no app**

```bash
npm run dev
```

Abra `http://localhost:3000/admin/catalog`, crie um produto e confirme que ele aparece. Confirme no Prisma Studio que o `workspaceId` foi gravado.

- [ ] **Step 5: Commit**

```bash
git add src/server/queries/catalog.ts src/server/actions/catalog.ts
git commit -m "refactor: catalogo passa pelo client escopado"
```

---

### Task 11: Vendas e clientes

**Files:**
- Modify: `src/server/queries/sales.ts`, `src/server/actions/sales.ts`, `src/server/queries/customers.ts`, `src/server/actions/customers.ts`

**Interfaces:**
- Consumes: `getWorkspaceDb`, `requireRole`
- Produces: nenhuma mudança de assinatura pública

- [ ] **Step 1: Migrar as queries**

Em `src/server/queries/sales.ts` e `src/server/queries/customers.ts`, aplique o mesmo padrão da Task 10. `buildSalesWhere` é função pura e não muda.

- [ ] **Step 2: Migrar `src/server/actions/sales.ts`**

Substitua `requireSession` por:

```ts
import { getWorkspaceContext, getWorkspaceDb } from "@/server/tenant/context";

async function requireSession() {
  return getWorkspaceContext();
}
```

O `user.id` usado em `createSale` passa a vir de `context.userId`. Acrescente `const db = await getWorkspaceDb();` no início de cada action.

Atenção especial em `createSale` e `updateSale`: os `db.stockMovement.create` dentro do laço e os `deleteMany` no início de `updateSale` **precisam** usar o client escopado, não o cru. São exatamente as chamadas que motivaram colocar `workspaceId` nas tabelas filhas.

- [ ] **Step 3: Migrar `src/server/actions/customers.ts`**

Mesmo padrão. Vendas e clientes são operação diária, então o papel exigido é qualquer membro — basta `getWorkspaceContext()`, sem `requireRole`.

- [ ] **Step 4: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Verificar o fluxo completo no app**

```bash
npm run dev
```

Registre uma venda com dois itens em `/sales/new`. No Prisma Studio, confirme que a `sale`, ambos os `sale_item` e ambos os `stock_movement` têm o mesmo `workspaceId`. Este é o teste que prova o walker funcionando em produção.

- [ ] **Step 6: Commit**

```bash
git add src/server/queries/sales.ts src/server/actions/sales.ts src/server/queries/customers.ts src/server/actions/customers.ts
git commit -m "refactor: vendas e clientes passam pelo client escopado"
```

---

### Task 12: Demais módulos

**Files:**
- Modify: `src/server/queries/` e `src/server/actions/` para `ingredients`, `markets`, `recipes`, `production`, e `src/server/queries/dashboard.ts`

**Interfaces:**
- Consumes: `getWorkspaceDb`, `requireRole`
- Produces: nenhuma mudança de assinatura pública

- [ ] **Step 1: Migrar ingredientes, mercados e receitas**

Mesmo padrão. Estes são cadastros: as actions usam `await requireRole("OWNER", "ADMIN")`.

Exceção: em `src/server/actions/markets.ts`, a action de **registro de compra de ingrediente** é operação diária e usa apenas `getWorkspaceContext()`. O cadastro de mercado exige ADMIN.

- [ ] **Step 2: Migrar produção**

`src/server/actions/production.ts` e `src/server/queries/production.ts` são operação: `getWorkspaceContext()`, sem `requireRole`.

- [ ] **Step 3: Migrar o dashboard**

`src/server/queries/dashboard.ts` é só leitura. Aplique `getWorkspaceDb()` em cada função exportada.

- [ ] **Step 4: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Confirmar que nenhum arquivo de server importa o client cru**

Run: `grep -rn "from \"@/lib/db\"" src/server/`
Expected: nenhuma saída.

- [ ] **Step 6: Percorrer o app**

```bash
npm run dev
```

Visite `/dashboard`, `/sales`, `/pantry`, `/markets`, `/customers`, `/admin/catalog`, `/admin/ingredients` e `/admin/recipes`. Cada uma deve carregar com os dados de sempre.

- [ ] **Step 7: Commit**

```bash
git add src/server
git commit -m "refactor: demais modulos passam pelo client escopado"
```

---

### Task 13: Impedir regressão por lint

Sem esta task a extension é convenção. Com ela, importar o client cru na camada de domínio quebra o build.

**Files:**
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: Fase 3 concluída
- Produces: erro de lint em qualquer import de `@/lib/db` sob `src/server/`

- [ ] **Step 1: Adicionar a regra ao `eslint.config.mjs`**

Acrescente ao array exportado, depois das configurações existentes:

```js
  {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/tenant/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db",
              message:
                "Use getWorkspaceDb() de @/server/tenant/context. O client cru nao aplica escopo de workspace.",
            },
          ],
        },
      ],
    },
  },
```

`src/server/tenant/**` fica de fora porque é justamente onde o client cru é legitimamente usado para construir o escopado.

- [ ] **Step 2: Provar que a regra dispara**

Adicione temporariamente `import { db } from "@/lib/db";` no topo de `src/server/queries/dashboard.ts` e rode:

Run: `npm run lint`
Expected: erro apontando `dashboard.ts` com a mensagem configurada.

Remova o import.

- [ ] **Step 3: Confirmar que não há query raw na camada de domínio**

O spec proíbe `$queryRaw` em `src/server/` porque a extension não consegue interceptá-lo.

Run: `grep -rn "queryRaw\|executeRaw" src/server/`
Expected: nenhuma saída. Se houver, reescreva a chamada com a API do Prisma antes de seguir.

- [ ] **Step 4: Confirmar o lint limpo**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tudo passa.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore: proibe import do client cru na camada de dominio"
```

---

## Estado ao fim deste plano

- 16 tabelas com `workspaceId` obrigatório, uniques e índices compostos
- Toda operação de domínio escopada automaticamente, inclusive escritas aninhadas
- Dados de produção migrados para o workspace Douce Vie
- Suíte de testes provando isolamento entre dois workspaces
- Regra de lint impedindo regressão
- Comportamento visível para o usuário **idêntico** ao de hoje

**Próximo plano:** workspaces e convites — plugin `organization`, `session.activeWorkspaceId` substituindo a resolução por primeira associação em `getWorkspaceContext`, seletor de workspace, papéis por membro, onboarding, convites por e-mail e migration 4 (remoção de `AllowedEmail` e `User.role`).
