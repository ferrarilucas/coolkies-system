# coolkies-mcp — API v1 + OAuth provider (coolkies-system) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o coolkies-system num Authorization Server OAuth 2.1 (via plugin `mcp` do better-auth) e expor uma API REST v1 autenticada por Bearer token, cobrindo workspaces/itens/lista de compras/clientes/vendas — a base de dados para o servidor MCP separado (`coolkies-mcp`, plano irmão).

**Architecture:** Rotas novas em `src/app/api/v1/*` (App Router route handlers), autenticadas via `auth.api.getMcpSession` (plugin `mcp` do better-auth), escopadas por workspace com o Prisma client já existente (`scopedDb`). Um "workspace ativo" por usuário é persistido numa tabela nova (`McpWorkspaceContext`), já que o token OAuth do MCP não é uma `Session` de navegador e não tem `activeWorkspaceId`.

**Tech Stack:** Next.js 15 App Router, Prisma 6, better-auth 1.6 (plugin `mcp`/`oidc-provider`), Vitest, Postgres (via `docker exec cookies_db psql`).

**Spec:** [docs/superpowers/specs/2026-09-17-coolkies-mcp-design.md](../specs/2026-09-17-coolkies-mcp-design.md)

## Global Constraints

- Migrations são **escritas à mão** e aplicadas via `docker exec -i cookies_db psql -U cookies -d <db>` — nunca rodar `prisma migrate dev` (memória do projeto: `pnpm db:up` já deve estar rodando).
- Use **pnpm**, nunca `npm`/`yarn`, para instalar pacotes ou rodar scripts.
- **Sem comentários inline no código** (instrução do usuário) — nenhum `//` explicando o óbvio.
- Todo texto de erro/mensagem voltado a humano é em **português**, igual ao já usado nas Server Actions equivalentes.
- Toda rota de escrita usa o Prisma client escopado (`context.db`, de `scopedDb(workspaceId)`) — nunca o `db` cru — para herdar a injeção automática de `workspaceId`.
- Testes rodam contra o banco real `cookies_test` (Vitest, `fileParallelism: false`), seguindo o padrão já usado em `src/server/**/*.test.ts` (`resetDb`/`testDb`/`createWorkspace` de `@/test/db`).

---

### Task 1: `McpWorkspaceContext` — schema e helper de contexto

**Files:**
- Modify: `prisma/schema.prisma` (novo model, após `AllowedEmail`; back-relations em `User` e `Workspace`)
- Create: `prisma/migrations/20260917130000_mcp_workspace_context/migration.sql`
- Modify: `src/test/db.ts` (adicionar `"mcp_workspace_context"` a `TABLES`)
- Create: `src/server/tenant/mcp-context.ts`
- Test: `src/server/tenant/mcp-context.test.ts`

**Interfaces:**
- Consumes: `NoWorkspaceError` de `src/server/tenant/context.ts` (já existe); `scopedDb` de `src/server/tenant/extension.ts`; `canWriteInWorkspace` de `src/server/tenant/subscription.ts`; `auth` de `@/lib/auth` (mockado nos testes).
- Produces (usado por todas as tasks A3-A7): `requireMcpUserId(request: NextRequest): Promise<string>`, `getMcpWorkspaceContext(request: NextRequest, ...allowedRoles: MemberRole[]): Promise<McpWorkspaceContext>` (onde `McpWorkspaceContext = { userId, workspaceId, role, canWrite, db: PrismaClient }`), `assertMcpCanWrite(context: McpWorkspaceContext): void`, `mcpErrorResponse(e: unknown): Response`, classes `McpAuthError`, `McpRoleError`, `McpReadOnlyError`.

- [ ] **Step 1: Editar o schema Prisma**

Em `prisma/schema.prisma`, logo após o model `AllowedEmail` (antes de `enum MemberRole`):

```prisma
model McpWorkspaceContext {
  userId      String    @id
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  updatedAt   DateTime  @updatedAt

  @@index([workspaceId])
  @@map("mcp_workspace_context")
}
```

No model `User`, adicione à lista de relações (depois de `subscription      Subscription?`):

```prisma
  mcpWorkspaceContext McpWorkspaceContext?
```

No model `Workspace`, adicione à lista de relações (depois de `shoppingListItems      ShoppingListItem[]`):

```prisma
  mcpWorkspaceContexts   McpWorkspaceContext[]
```

- [ ] **Step 2: Criar a migration escrita à mão**

Crie `prisma/migrations/20260917130000_mcp_workspace_context/migration.sql`:

```sql
BEGIN;

CREATE TABLE "mcp_workspace_context" (
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_workspace_context_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "mcp_workspace_context"
  ADD CONSTRAINT "mcp_workspace_context_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_workspace_context"
  ADD CONSTRAINT "mcp_workspace_context_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "mcp_workspace_context_workspaceId_idx" ON "mcp_workspace_context"("workspaceId");

COMMIT;
```

- [ ] **Step 3: Aplicar a migration nos dois bancos e gerar o client**

Rode (com `pnpm db:up` já ativo):

```bash
cat prisma/migrations/20260917130000_mcp_workspace_context/migration.sql | docker exec -i cookies_db psql -U cookies -d cookies
```

```bash
cat prisma/migrations/20260917130000_mcp_workspace_context/migration.sql | docker exec -i cookies_db psql -U cookies -d cookies_test
```

```bash
pnpm prisma generate
```

- [ ] **Step 4: Adicionar a tabela nova ao `resetDb()`**

Em `src/test/db.ts`, adicione `"mcp_workspace_context"` ao array `TABLES` (qualquer posição serve, o `TRUNCATE ... CASCADE` resolve a ordem):

```ts
const TABLES = [
  "mcp_workspace_context",
  "member",
  ...
```

- [ ] **Step 5: Escrever os testes (vão falhar — `./mcp-context` ainda não existe)**

Crie `src/server/tenant/mcp-context.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { getMcpWorkspaceContext, assertMcpCanWrite, McpAuthError, McpRoleError, McpReadOnlyError } = await import(
  "./mcp-context"
);
const { NoWorkspaceError } = await import("./context");

function fakeRequest(): NextRequest {
  return new Request("http://localhost/api/v1/items") as unknown as NextRequest;
}

describe("getMcpWorkspaceContext", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("lança McpAuthError sem sessão MCP válida", async () => {
    await expect(getMcpWorkspaceContext(fakeRequest())).rejects.toThrow(McpAuthError);
  });

  it("usa o workspace salvo em McpWorkspaceContext quando existe", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const ws1 = await createWorkspace("Loja 1");
    const ws2 = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws2.id, role: "MEMBER" } });
    await testDb.mcpWorkspaceContext.create({ data: { userId: user.id, workspaceId: ws2.id } });
    mcpSessionResult = { userId: user.id };

    const context = await getMcpWorkspaceContext(fakeRequest());

    expect(context.workspaceId).toBe(ws2.id);
    expect(context.role).toBe("MEMBER");
  });

  it("cai para o primeiro workspace do usuário quando não há contexto salvo", async () => {
    const user = await testDb.user.create({ data: { id: "u2", name: "Beto", email: "beto@example.com" } });
    const ws1 = await createWorkspace("Loja A");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "OWNER" } });
    mcpSessionResult = { userId: user.id };

    const context = await getMcpWorkspaceContext(fakeRequest());

    expect(context.workspaceId).toBe(ws1.id);
  });

  it("lança NoWorkspaceError quando o usuário não pertence a nenhum workspace", async () => {
    const user = await testDb.user.create({ data: { id: "u3", name: "Caio", email: "caio@example.com" } });
    mcpSessionResult = { userId: user.id };

    await expect(getMcpWorkspaceContext(fakeRequest())).rejects.toThrow(NoWorkspaceError);
  });

  it("lança McpRoleError quando o papel não está entre os permitidos", async () => {
    const user = await testDb.user.create({ data: { id: "u4", name: "Duda", email: "duda@example.com" } });
    const ws1 = await createWorkspace("Loja B");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "MEMBER" } });
    mcpSessionResult = { userId: user.id };

    await expect(getMcpWorkspaceContext(fakeRequest(), "OWNER", "ADMIN")).rejects.toThrow(McpRoleError);
  });
});

describe("assertMcpCanWrite", () => {
  it("lança McpReadOnlyError quando canWrite é false", () => {
    expect(() =>
      assertMcpCanWrite({
        userId: "u1",
        workspaceId: "w1",
        role: "OWNER",
        canWrite: false,
        db: testDb as never,
      }),
    ).toThrow(McpReadOnlyError);
  });
});
```

- [ ] **Step 6: Rodar os testes e confirmar que falham**

Run: `pnpm vitest run src/server/tenant/mcp-context.test.ts`
Expected: FAIL — `Cannot find module './mcp-context'`

- [ ] **Step 7: Implementar `src/server/tenant/mcp-context.ts`**

```ts
import type { NextRequest } from "next/server";
import type { MemberRole, PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopedDb } from "./extension";
import { canWriteInWorkspace } from "./subscription";
import { NoWorkspaceError } from "./context";

export class McpAuthError extends Error {
  constructor() {
    super("Token inválido ou expirado.");
    this.name = "McpAuthError";
  }
}

export class McpRoleError extends Error {
  constructor() {
    super("Não autorizado.");
    this.name = "McpRoleError";
  }
}

export class McpReadOnlyError extends Error {
  constructor() {
    super("Este workspace está em modo somente leitura. Ative um plano para voltar a registrar.");
    this.name = "McpReadOnlyError";
  }
}

export async function requireMcpUserId(request: NextRequest): Promise<string> {
  const session = await auth.api.getMcpSession({ headers: request.headers });
  const userId = (session as { userId?: string } | null)?.userId;
  if (!userId) throw new McpAuthError();
  return userId;
}

export type McpWorkspaceContext = {
  userId: string;
  workspaceId: string;
  role: MemberRole;
  canWrite: boolean;
  db: PrismaClient;
};

export async function getMcpWorkspaceContext(
  request: NextRequest,
  ...allowedRoles: MemberRole[]
): Promise<McpWorkspaceContext> {
  const userId = await requireMcpUserId(request);

  const saved = await db.mcpWorkspaceContext.findUnique({ where: { userId } });
  const membership =
    (saved
      ? await db.member.findFirst({ where: { userId, workspaceId: saved.workspaceId } })
      : null) ?? (await db.member.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }));

  if (!membership) throw new NoWorkspaceError();

  if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
    throw new McpRoleError();
  }

  const canWrite = await canWriteInWorkspace(membership.workspaceId);

  return {
    userId,
    workspaceId: membership.workspaceId,
    role: membership.role,
    canWrite,
    db: scopedDb(membership.workspaceId),
  };
}

export function assertMcpCanWrite(context: McpWorkspaceContext): void {
  if (!context.canWrite) throw new McpReadOnlyError();
}

export function mcpErrorResponse(e: unknown): Response {
  if (e instanceof McpAuthError) return Response.json({ error: e.message }, { status: 401 });
  if (e instanceof McpRoleError || e instanceof McpReadOnlyError) {
    return Response.json({ error: e.message }, { status: 403 });
  }
  if (e instanceof NoWorkspaceError) return Response.json({ error: e.message }, { status: 404 });
  const message = e instanceof Error ? e.message : "Erro inesperado.";
  return Response.json({ error: message }, { status: 400 });
}
```

- [ ] **Step 8: Rodar os testes e confirmar que passam**

Run: `pnpm vitest run src/server/tenant/mcp-context.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260917130000_mcp_workspace_context src/test/db.ts src/server/tenant/mcp-context.ts src/server/tenant/mcp-context.test.ts
git commit -m "feat(mcp): tabela McpWorkspaceContext e helper de contexto por token OAuth"
```

---

### Task 2: OAuth provider — schema `oidc-provider` + plugin `mcp` do better-auth

**Files:**
- Modify: `prisma/schema.prisma` (models `OauthApplication`, `OauthAccessToken`, `OauthConsent`; back-relations em `User`)
- Create: `prisma/migrations/20260917140000_oauth_provider/migration.sql`
- Modify: `src/test/db.ts` (adicionar as 3 tabelas novas a `TABLES`)
- Modify: `src/lib/auth.ts` (plugin `mcp`)
- Modify: `.env.example` (nenhuma variável nova é obrigatória — `BETTER_AUTH_URL` já existe e agora também alimenta o issuer do MCP)
- Test: `src/lib/auth.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `auth.api.getMcpSession({ headers })` funcional (consumido por `requireMcpUserId` da Task 1 em produção — nos testes daquela task, ele é mockado); endpoints `/api/auth/mcp/*` e `/api/auth/.well-known/oauth-authorization-server` e `/api/auth/.well-known/oauth-protected-resource` (usados pelo fluxo OAuth do `coolkies-mcp`, plano irmão).

- [ ] **Step 1: Editar o schema Prisma**

Em `prisma/schema.prisma`, logo após o model `McpWorkspaceContext` (criado na Task 1), adicione:

```prisma
model OauthApplication {
  id           String   @id @default(cuid())
  name         String
  icon         String?
  metadata     String?
  clientId     String   @unique
  clientSecret String?
  redirectUrls String
  type         String
  disabled     Boolean  @default(false)
  userId       String?
  user         User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  accessTokens OauthAccessToken[]
  consents     OauthConsent[]

  @@index([userId])
  @@map("oauth_application")
}

model OauthAccessToken {
  id                    String           @id @default(cuid())
  accessToken           String           @unique
  refreshToken          String           @unique
  accessTokenExpiresAt  DateTime
  refreshTokenExpiresAt DateTime
  clientId              String
  client                OauthApplication @relation(fields: [clientId], references: [clientId], onDelete: Cascade)
  userId                String?
  user                  User?            @relation(fields: [userId], references: [id], onDelete: Cascade)
  scopes                String
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt

  @@index([clientId])
  @@index([userId])
  @@map("oauth_access_token")
}

model OauthConsent {
  id           String           @id @default(cuid())
  clientId     String
  client       OauthApplication @relation(fields: [clientId], references: [clientId], onDelete: Cascade)
  userId       String
  user         User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  scopes       String
  consentGiven Boolean
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  @@index([clientId])
  @@index([userId])
  @@map("oauth_consent")
}
```

No model `User`, adicione (depois de `mcpWorkspaceContext McpWorkspaceContext?`, criado na Task 1):

```prisma
  oauthApplications   OauthApplication[]
  oauthAccessTokens   OauthAccessToken[]
  oauthConsents       OauthConsent[]
```

- [ ] **Step 2: Criar a migration**

Crie `prisma/migrations/20260917140000_oauth_provider/migration.sql`:

```sql
BEGIN;

CREATE TABLE "oauth_application" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "metadata" TEXT,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "redirectUrls" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_application_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_application_clientId_key" ON "oauth_application"("clientId");
CREATE INDEX "oauth_application_userId_idx" ON "oauth_application"("userId");

ALTER TABLE "oauth_application"
  ADD CONSTRAINT "oauth_application_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "oauth_access_token" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "scopes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_access_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_access_token_accessToken_key" ON "oauth_access_token"("accessToken");
CREATE UNIQUE INDEX "oauth_access_token_refreshToken_key" ON "oauth_access_token"("refreshToken");
CREATE INDEX "oauth_access_token_clientId_idx" ON "oauth_access_token"("clientId");
CREATE INDEX "oauth_access_token_userId_idx" ON "oauth_access_token"("userId");

ALTER TABLE "oauth_access_token"
  ADD CONSTRAINT "oauth_access_token_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "oauth_application"("clientId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauth_access_token"
  ADD CONSTRAINT "oauth_access_token_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "oauth_consent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "consentGiven" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_consent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "oauth_consent_clientId_idx" ON "oauth_consent"("clientId");
CREATE INDEX "oauth_consent_userId_idx" ON "oauth_consent"("userId");

ALTER TABLE "oauth_consent"
  ADD CONSTRAINT "oauth_consent_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "oauth_application"("clientId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauth_consent"
  ADD CONSTRAINT "oauth_consent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
```

- [ ] **Step 3: Aplicar nos dois bancos e gerar o client**

```bash
cat prisma/migrations/20260917140000_oauth_provider/migration.sql | docker exec -i cookies_db psql -U cookies -d cookies
```

```bash
cat prisma/migrations/20260917140000_oauth_provider/migration.sql | docker exec -i cookies_db psql -U cookies -d cookies_test
```

```bash
pnpm prisma generate
```

- [ ] **Step 4: Adicionar as tabelas novas ao `resetDb()`**

Em `src/test/db.ts`, adicione `"oauth_consent"`, `"oauth_access_token"`, `"oauth_application"` ao array `TABLES`.

- [ ] **Step 5: Escrever os testes (vão falhar — plugin ainda não wireado)**

Crie `src/lib/auth.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { auth } from "./auth";

describe("oidc-provider schema", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("grava e lê uma aplicação OAuth e seu token de acesso", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const application = await testDb.oauthApplication.create({
      data: {
        name: "Claude Desktop",
        clientId: "client-1",
        clientSecret: "secret-1",
        redirectUrls: "http://localhost/callback",
        type: "public",
        userId: user.id,
      },
    });
    await testDb.oauthAccessToken.create({
      data: {
        accessToken: "tok-1",
        refreshToken: "ref-1",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        refreshTokenExpiresAt: new Date(Date.now() + 604800_000),
        clientId: application.clientId,
        userId: user.id,
        scopes: "openid profile",
      },
    });

    const found = await testDb.oauthAccessToken.findUnique({ where: { accessToken: "tok-1" } });
    expect(found?.userId).toBe(user.id);
    expect(found?.clientId).toBe(application.clientId);
  });
});

describe("mcp plugin", () => {
  it("expõe o discovery document OAuth do MCP", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/.well-known/oauth-authorization-server"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_endpoint).toContain("/mcp/authorize");
    expect(body.token_endpoint).toContain("/mcp/token");
    expect(body.registration_endpoint).toContain("/mcp/register");
  });

  it("expõe o protected resource metadata", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/.well-known/oauth-protected-resource"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_servers).toContain("http://localhost:3000");
  });
});
```

- [ ] **Step 6: Rodar os testes e confirmar que os dois últimos falham**

Run: `pnpm vitest run src/lib/auth.test.ts`
Expected: o teste de schema (`oidc-provider schema`) PASSA (as tabelas já existem desde o Step 3); os dois testes de `mcp plugin` FALHAM (404 ou corpo vazio, porque o plugin ainda não está registrado).

- [ ] **Step 7: Adicionar o plugin `mcp` em `src/lib/auth.ts`**

```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { mcp } from "better-auth/plugins";
import { db } from "./db";
import { normalizeEmail } from "./allowlist";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  plugins: [mcp({ loginPage: "/sign-in" })],
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "USER",
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          return { data: { ...user, email: normalizeEmail(user.email) } };
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
```

- [ ] **Step 8: Rodar os testes e confirmar que passam**

Run: `pnpm vitest run src/lib/auth.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260917140000_oauth_provider src/test/db.ts src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat(mcp): plugin OAuth do better-auth (mcp/oidc-provider) e schema correspondente"
```

---

### Task 3: `/api/v1/workspaces` (GET) + `/api/v1/workspaces/active` (PUT)

**Files:**
- Create: `src/app/api/v1/workspaces/route.ts`
- Create: `src/app/api/v1/workspaces/active/route.ts`
- Test: `src/app/api/v1/workspaces/route.test.ts`
- Test: `src/app/api/v1/workspaces/active/route.test.ts`

**Interfaces:**
- Consumes: `requireMcpUserId`, `mcpErrorResponse`, `McpAuthError` de `@/server/tenant/mcp-context` (Task 1); `db` de `@/lib/db`.
- Produces: `GET /api/v1/workspaces` → `{ workspaces: Array<{ id, name, slug, role, active }> }`; `PUT /api/v1/workspaces/active` (body `{ workspaceId }`) → `{ id, name, slug, role }`. Consumido pelas tools `list_workspaces`/`set_active_workspace` do `coolkies-mcp` (plano irmão).

- [ ] **Step 1: Escrever os testes (vão falhar — rotas não existem)**

Crie `src/app/api/v1/workspaces/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { GET } = await import("./route");

function req(): NextRequest {
  return new NextRequest("http://localhost/api/v1/workspaces");
}

describe("GET /api/v1/workspaces", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("retorna 401 sem sessão MCP", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("lista os workspaces do usuário com o papel e qual está ativo", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const ws1 = await createWorkspace("Loja 1");
    const ws2 = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws2.id, role: "MEMBER" } });
    await testDb.mcpWorkspaceContext.create({ data: { userId: user.id, workspaceId: ws2.id } });
    mcpSessionResult = { userId: user.id };

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.workspaces).toHaveLength(2);
    const active = body.workspaces.find((w: { active: boolean }) => w.active);
    expect(active.id).toBe(ws2.id);
  });
});
```

Crie `src/app/api/v1/workspaces/active/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { PUT } = await import("./route");

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/workspaces/active", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("PUT /api/v1/workspaces/active", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("troca o workspace ativo quando o usuário é membro", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const ws1 = await createWorkspace("Loja 1");
    const ws2 = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws1.id, role: "OWNER" } });
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws2.id, role: "MEMBER" } });
    mcpSessionResult = { userId: user.id };

    const res = await PUT(req({ workspaceId: ws2.id }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(ws2.id);

    const saved = await testDb.mcpWorkspaceContext.findUnique({ where: { userId: user.id } });
    expect(saved?.workspaceId).toBe(ws2.id);
  });

  it("retorna 404 quando o usuário não participa do workspace", async () => {
    const user = await testDb.user.create({ data: { id: "u2", name: "Beto", email: "beto@example.com" } });
    const otherWs = await createWorkspace("Loja de outra pessoa");
    mcpSessionResult = { userId: user.id };

    const res = await PUT(req({ workspaceId: otherWs.id }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/app/api/v1/workspaces`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar `src/app/api/v1/workspaces/route.ts`**

```ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireMcpUserId, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireMcpUserId(request);

    const [members, active] = await Promise.all([
      db.member.findMany({
        where: { userId },
        include: { workspace: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.mcpWorkspaceContext.findUnique({ where: { userId } }),
    ]);

    const activeWorkspaceId = active?.workspaceId ?? members[0]?.workspaceId ?? null;

    const workspaces = members.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
      active: m.workspaceId === activeWorkspaceId,
    }));

    return Response.json({ workspaces });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
```

- [ ] **Step 4: Implementar `src/app/api/v1/workspaces/active/route.ts`**

```ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireMcpUserId, mcpErrorResponse } from "@/server/tenant/mcp-context";

const bodySchema = z.object({ workspaceId: z.string().min(1) });

export async function PUT(request: NextRequest) {
  try {
    const userId = await requireMcpUserId(request);
    const body = bodySchema.parse(await request.json());

    const membership = await db.member.findFirst({
      where: { userId, workspaceId: body.workspaceId },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
    });
    if (!membership) {
      return Response.json({ error: "Você não participa deste workspace." }, { status: 404 });
    }

    await db.mcpWorkspaceContext.upsert({
      where: { userId },
      create: { userId, workspaceId: body.workspaceId },
      update: { workspaceId: body.workspaceId },
    });

    return Response.json({
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
      role: membership.role,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return Response.json({ error: "workspaceId é obrigatório." }, { status: 400 });
    }
    return mcpErrorResponse(e);
  }
}
```

- [ ] **Step 5: Rodar e confirmar que passam**

Run: `pnpm vitest run src/app/api/v1/workspaces`
Expected: PASS (4 testes)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/workspaces
git commit -m "feat(mcp): rotas /api/v1/workspaces (listar e trocar workspace ativo)"
```

---

### Task 4: `/api/v1/items` (GET, POST)

**Files:**
- Create: `src/app/api/v1/items/route.ts`
- Test: `src/app/api/v1/items/route.test.ts`

**Interfaces:**
- Consumes: `getMcpWorkspaceContext`, `assertMcpCanWrite`, `mcpErrorResponse` de `@/server/tenant/mcp-context` (Task 1); `normalizeName` de `@/lib/text`.
- Produces: `GET /api/v1/items` → `{ items: Array<{ id, name, unit, sellable, productionInput, minStock }> }`; `POST /api/v1/items` (body `{ name, unit, sellable, productionInput, minStock? }`) → `{ item }`, 201. Só OWNER/ADMIN podem criar. Consumido pelas tools `list_items`/`create_item` do `coolkies-mcp`.

- [ ] **Step 1: Escrever os testes**

Crie `src/app/api/v1/items/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { GET, POST } = await import("./route");

async function seedOwner() {
  const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
  const ws = await createWorkspace("Loja 1");
  await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "OWNER" } });
  mcpSessionResult = { userId: user.id };
  return { user, ws };
}

function getReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/items");
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/items", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/v1/items", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("lista os itens ativos do workspace ativo", async () => {
    const { ws } = await seedOwner();
    await testDb.item.create({ data: { name: "Açúcar", unit: "G", productionInput: true, workspaceId: ws.id } });

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Açúcar");
  });
});

describe("POST /api/v1/items", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("cria um item vendável", async () => {
    await seedOwner();

    const res = await POST(postReq({ name: "Refrigerante", unit: "UN", sellable: true, productionInput: false }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.item.sellable).toBe(true);
  });

  it("recusa item sem nenhuma finalidade marcada", async () => {
    await seedOwner();

    const res = await POST(postReq({ name: "Sem finalidade", unit: "G", sellable: false, productionInput: false }));
    expect(res.status).toBe(400);
  });

  it("recusa item vendável com unidade diferente de UN", async () => {
    await seedOwner();

    const res = await POST(postReq({ name: "Errado", unit: "G", sellable: true, productionInput: false }));
    expect(res.status).toBe(400);
  });

  it("retorna 403 quando o papel não é OWNER/ADMIN", async () => {
    const user = await testDb.user.create({ data: { id: "u2", name: "Beto", email: "beto@example.com" } });
    const ws = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ name: "Item", unit: "UN", sellable: true, productionInput: false }));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/app/api/v1/items`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar `src/app/api/v1/items/route.ts`**

```ts
import { NextRequest } from "next/server";
import { BaseUnit } from "@prisma/client";
import { normalizeName } from "@/lib/text";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function GET(request: NextRequest) {
  try {
    const { db } = await getMcpWorkspaceContext(request);
    const items = await db.item.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        sellable: true,
        productionInput: true,
        minStock: true,
      },
    });
    return Response.json({ items });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}

function parseUnit(value: unknown): BaseUnit {
  if (value === "ML") return BaseUnit.ML;
  if (value === "UN") return BaseUnit.UN;
  return BaseUnit.G;
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request, "OWNER", "ADMIN");
    assertMcpCanWrite(context);

    const body = await request.json();
    const name = normalizeName(String(body.name ?? ""));
    const unit = parseUnit(body.unit);
    const minStock =
      typeof body.minStock === "number" && !Number.isNaN(body.minStock) ? body.minStock : null;
    const productionInput = Boolean(body.productionInput);
    const sellable = Boolean(body.sellable);

    if (!name) return Response.json({ error: "Nome obrigatório." }, { status: 400 });
    if (!productionInput && !sellable) {
      return Response.json({ error: "Marque insumo de produção e/ou venda." }, { status: 400 });
    }
    if (sellable && unit !== BaseUnit.UN) {
      return Response.json(
        { error: 'Venda só é permitida para itens com unidade "Unidade (un)".' },
        { status: 400 },
      );
    }

    try {
      const item = await context.db.item.create({
        data: { name, unit, minStock, productionInput, sellable },
      });
      return Response.json({ item }, { status: 201 });
    } catch {
      return Response.json({ error: "Já existe um item com esse nome." }, { status: 409 });
    }
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `pnpm vitest run src/app/api/v1/items`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/items
git commit -m "feat(mcp): rota /api/v1/items (listar e criar itens do catálogo)"
```

---

### Task 5: `/api/v1/shopping-list` (GET, POST)

**Files:**
- Create: `src/app/api/v1/shopping-list/route.ts`
- Test: `src/app/api/v1/shopping-list/route.test.ts`

**Interfaces:**
- Consumes: `getMcpWorkspaceContext`, `assertMcpCanWrite`, `mcpErrorResponse` de `@/server/tenant/mcp-context` (Task 1).
- Produces: `GET /api/v1/shopping-list` → `{ items: Array<{ id, itemId, label, quantity, unit }> }`; `POST /api/v1/shopping-list` (body `{ label, itemId?, quantity?, unit? }`) → `{ item }`, 201. Consumido pelas tools `list_shopping_list_items`/`add_shopping_list_item` do `coolkies-mcp`.

- [ ] **Step 1: Escrever os testes**

Crie `src/app/api/v1/shopping-list/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { GET, POST } = await import("./route");

async function seedMember() {
  const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
  const ws = await createWorkspace("Loja 1");
  await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
  mcpSessionResult = { userId: user.id };
  return { user, ws };
}

function getReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/shopping-list");
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/shopping-list", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/v1/shopping-list", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("lista os itens pendentes", async () => {
    const { ws } = await seedMember();
    await testDb.shoppingListItem.create({ data: { label: "Farinha", workspaceId: ws.id } });
    await testDb.shoppingListItem.create({ data: { label: "Já comprado", done: true, workspaceId: ws.id } });

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].label).toBe("Farinha");
  });
});

describe("POST /api/v1/shopping-list", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("adiciona um item com descrição", async () => {
    await seedMember();

    const res = await POST(postReq({ label: "Ovos", quantity: 30, unit: "UN" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.item.label).toBe("Ovos");
    expect(body.item.quantity).toBe(30);
  });

  it("recusa item sem descrição", async () => {
    await seedMember();

    const res = await POST(postReq({ label: "" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/app/api/v1/shopping-list`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar `src/app/api/v1/shopping-list/route.ts`**

```ts
import { NextRequest } from "next/server";
import { BaseUnit } from "@prisma/client";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function GET(request: NextRequest) {
  try {
    const { db } = await getMcpWorkspaceContext(request);
    const items = await db.shoppingListItem.findMany({
      where: { done: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, itemId: true, label: true, quantity: true, unit: true },
    });
    return Response.json({ items });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const itemId = typeof body.itemId === "string" && body.itemId.trim() ? body.itemId : null;
    const label = String(body.label ?? "").trim();
    const quantity =
      typeof body.quantity === "number" && !Number.isNaN(body.quantity) ? body.quantity : null;
    const unit = typeof body.unit === "string" && body.unit ? (body.unit as BaseUnit) : null;

    if (!label) return Response.json({ error: "Descreva o item." }, { status: 400 });

    const created = await context.db.shoppingListItem.create({
      data: { itemId, label, quantity, unit },
    });
    return Response.json({ item: created }, { status: 201 });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `pnpm vitest run src/app/api/v1/shopping-list`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/shopping-list
git commit -m "feat(mcp): rota /api/v1/shopping-list (listar e adicionar itens)"
```

---

### Task 6: `/api/v1/customers` (GET com busca, POST)

**Files:**
- Create: `src/app/api/v1/customers/route.ts`
- Test: `src/app/api/v1/customers/route.test.ts`

**Interfaces:**
- Consumes: `getMcpWorkspaceContext`, `assertMcpCanWrite`, `mcpErrorResponse` de `@/server/tenant/mcp-context` (Task 1); `normalizeName` de `@/lib/text`.
- Produces: `GET /api/v1/customers?q=` → `{ customers: Array<{ id, name, email, phone, sector }> }` (busca por nome/e-mail/telefone); `POST /api/v1/customers` (body `{ name, email?, phone?, sector?, notes? }`) → `{ customer }`, 201. Consumido pelas tools `list_customers`/`create_customer` do `coolkies-mcp`.

- [ ] **Step 1: Escrever os testes**

Crie `src/app/api/v1/customers/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { GET, POST } = await import("./route");

async function seedMember() {
  const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
  const ws = await createWorkspace("Loja 1");
  await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
  mcpSessionResult = { userId: user.id };
  return { user, ws };
}

function getReq(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v1/customers${query}`);
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/customers", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/v1/customers", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("busca por telefone", async () => {
    const { ws } = await seedMember();
    await testDb.customer.create({ data: { name: "Maria", phone: "11999998888", workspaceId: ws.id } });
    await testDb.customer.create({ data: { name: "João", phone: "11777776666", workspaceId: ws.id } });

    const res = await GET(getReq("?q=9999"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].name).toBe("Maria");
  });

  it("sem query lista até 20 clientes", async () => {
    await seedMember();

    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customers).toEqual([]);
  });
});

describe("POST /api/v1/customers", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("cria um cliente", async () => {
    await seedMember();

    const res = await POST(postReq({ name: "Nova Cliente", email: "nova@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.customer.name).toBe("Nova Cliente");
  });

  it("recusa e-mail duplicado no mesmo workspace", async () => {
    const { ws } = await seedMember();
    await testDb.customer.create({ data: { name: "Existente", email: "dup@example.com", workspaceId: ws.id } });

    const res = await POST(postReq({ name: "Outra", email: "dup@example.com" }));
    expect(res.status).toBe(409);
  });

  it("recusa cliente sem nome", async () => {
    await seedMember();

    const res = await POST(postReq({ name: "" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/app/api/v1/customers`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar `src/app/api/v1/customers/route.ts`**

```ts
import { NextRequest } from "next/server";
import { normalizeName } from "@/lib/text";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function GET(request: NextRequest) {
  try {
    const { db } = await getMcpWorkspaceContext(request);
    const q = request.nextUrl.searchParams.get("q")?.trim();

    const customers = await db.customer.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : undefined,
      orderBy: { name: "asc" },
      take: 20,
      select: { id: true, name: true, email: true, phone: true, sector: true },
    });
    return Response.json({ customers });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const name = normalizeName(String(body.name ?? ""));
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
    const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
    const sector = typeof body.sector === "string" && body.sector.trim() ? body.sector.trim() : null;
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    if (!name) return Response.json({ error: "Nome é obrigatório." }, { status: 400 });

    try {
      const customer = await context.db.customer.create({
        data: { name, email, phone, sector, notes },
        select: { id: true, name: true, email: true, phone: true, sector: true },
      });
      return Response.json({ customer }, { status: 201 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("Unique constraint") && msg.includes("email")) {
        return Response.json({ error: "Este e-mail já está cadastrado." }, { status: 409 });
      }
      return Response.json({ error: "Erro ao criar cliente." }, { status: 400 });
    }
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `pnpm vitest run src/app/api/v1/customers`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/customers
git commit -m "feat(mcp): rota /api/v1/customers (buscar e criar clientes)"
```

---

### Task 7: `/api/v1/sales` (GET com filtros, POST) + `/api/v1/sales/mark-paid` (POST)

**Files:**
- Create: `src/app/api/v1/sales/route.ts`
- Create: `src/app/api/v1/sales/mark-paid/route.ts`
- Test: `src/app/api/v1/sales/route.test.ts`
- Test: `src/app/api/v1/sales/mark-paid/route.test.ts`

**Interfaces:**
- Consumes: `getMcpWorkspaceContext`, `assertMcpCanWrite`, `mcpErrorResponse` de `@/server/tenant/mcp-context` (Task 1).
- Produces: `GET /api/v1/sales` (query: `status`, `q`, `customerId`, `from`, `to`, `forecastFrom`, `forecastTo`, `overdueOnly`) → `{ sales, summary: { pendingCents, pendingCount, paidCents, paidCount, overdueCents, overdueCount } }`; `POST /api/v1/sales` (body com `items[]` obrigatório) → `{ sale: { id, totalCents } }`, 201; `POST /api/v1/sales/mark-paid` (body `{ saleId }` ou `{ saleIds }` ou `{ customerId }`) → `{ count, totalCents }`. Consumido pelas tools `list_sales`/`create_sale`/`mark_sales_as_paid` do `coolkies-mcp`.

- [ ] **Step 1: Escrever os testes**

Crie `src/app/api/v1/sales/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { GET, POST } = await import("./route");

async function seedMember() {
  const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
  const ws = await createWorkspace("Loja 1");
  await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
  mcpSessionResult = { userId: user.id };
  return { user, ws };
}

function getReq(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v1/sales${query}`);
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/sales", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/v1/sales", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("filtra por customerId e status, e soma o resumo pendente", async () => {
    const { user, ws } = await seedMember();
    const customer = await testDb.customer.create({ data: { name: "Maria", workspaceId: ws.id } });
    await testDb.sale.create({
      data: {
        userId: user.id,
        workspaceId: ws.id,
        customerId: customer.id,
        status: "PENDING",
        totalCents: 5000,
        soldAt: new Date(),
      },
    });
    await testDb.sale.create({
      data: {
        userId: user.id,
        workspaceId: ws.id,
        customerId: customer.id,
        status: "PAID",
        totalCents: 3000,
        soldAt: new Date(),
      },
    });

    const res = await GET(getReq(`?customerId=${customer.id}&status=PENDING`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sales).toHaveLength(1);
    expect(body.summary.pendingCents).toBe(5000);
  });
});

describe("POST /api/v1/sales", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("cria uma venda com itens e desconta do estoque", async () => {
    const { ws } = await seedMember();
    const item = await testDb.item.create({ data: { name: "Bolo", unit: "UN", sellable: true, workspaceId: ws.id } });

    const res = await POST(
      postReq({
        customerName: "Cliente Avulso",
        items: [
          { itemId: item.id, productName: "Bolo", variantId: null, flavorName: null, quantity: 2, unitPriceCents: 1500 },
        ],
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.sale.totalCents).toBe(3000);

    const movement = await testDb.stockMovement.findFirst({ where: { saleId: body.sale.id } });
    expect(movement?.quantity).toBe(-2);
  });

  it("recusa venda sem itens", async () => {
    await seedMember();

    const res = await POST(postReq({ items: [] }));
    expect(res.status).toBe(400);
  });
});
```

Crie `src/app/api/v1/sales/mark-paid/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, testDb, createWorkspace } from "@/test/db";

let mcpSessionResult: { userId: string } | null;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getMcpSession: async () => mcpSessionResult } },
}));

const { POST } = await import("./route");

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/sales/mark-paid", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/v1/sales/mark-paid", () => {
  beforeEach(async () => {
    await resetDb();
    mcpSessionResult = null;
  });

  it("marca todas as vendas pendentes de um cliente como pagas", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const ws = await createWorkspace("Loja 1");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    const customer = await testDb.customer.create({ data: { name: "Maria", workspaceId: ws.id } });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: ws.id, customerId: customer.id, status: "PENDING", totalCents: 2000, soldAt: new Date() },
    });
    await testDb.sale.create({
      data: { userId: user.id, workspaceId: ws.id, customerId: customer.id, status: "PENDING", totalCents: 3000, soldAt: new Date() },
    });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ customerId: customer.id }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.totalCents).toBe(5000);

    const remaining = await testDb.sale.count({ where: { customerId: customer.id, status: "PENDING" } });
    expect(remaining).toBe(0);
  });

  it("retorna 404 quando não há venda pendente encontrada", async () => {
    const user = await testDb.user.create({ data: { id: "u2", name: "Beto", email: "beto@example.com" } });
    const ws = await createWorkspace("Loja 2");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({ saleId: "inexistente" }));
    expect(res.status).toBe(404);
  });

  it("retorna 400 quando nenhum identificador é informado", async () => {
    const user = await testDb.user.create({ data: { id: "u3", name: "Caio", email: "caio@example.com" } });
    const ws = await createWorkspace("Loja 3");
    await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "MEMBER" } });
    mcpSessionResult = { userId: user.id };

    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/app/api/v1/sales`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar `src/app/api/v1/sales/route.ts`**

```ts
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { StockMovementType } from "@prisma/client";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";

type SalesFilters = {
  status?: "PAID" | "PENDING";
  q?: string;
  customerId?: string;
  from?: string;
  to?: string;
  forecastFrom?: string;
  forecastTo?: string;
  overdueOnly?: boolean;
};

function buildSalesWhere(f: SalesFilters): Prisma.SaleWhereInput {
  const search = f.q?.trim();
  const forecast: Prisma.DateTimeNullableFilter = {
    ...(f.forecastFrom ? { gte: new Date(f.forecastFrom) } : {}),
    ...(f.forecastTo ? { lte: new Date(f.forecastTo) } : {}),
    ...(f.overdueOnly ? { lt: new Date() } : {}),
  };
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.overdueOnly ? { status: "PENDING" } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.from || f.to
      ? {
          soldAt: {
            ...(f.from ? { gte: new Date(f.from) } : {}),
            ...(f.to ? { lte: new Date(f.to) } : {}),
          },
        }
      : {}),
    ...(Object.keys(forecast).length > 0 ? { paymentForecastDate: forecast } : {}),
    ...(search
      ? {
          OR: [
            { customerName: { contains: search, mode: "insensitive" } },
            { customer: { sector: { contains: search, mode: "insensitive" } } },
            { notes: { contains: search, mode: "insensitive" } },
            { items: { some: { productNameSnapshot: { contains: search, mode: "insensitive" } } } },
            { items: { some: { flavorNameSnapshot: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}

function parseFilters(searchParams: URLSearchParams): SalesFilters {
  const status = searchParams.get("status");
  return {
    status: status === "PAID" || status === "PENDING" ? status : undefined,
    q: searchParams.get("q") ?? undefined,
    customerId: searchParams.get("customerId") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    forecastFrom: searchParams.get("forecastFrom") ?? undefined,
    forecastTo: searchParams.get("forecastTo") ?? undefined,
    overdueOnly: searchParams.get("overdueOnly") === "true",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { db } = await getMcpWorkspaceContext(request);
    const filters = parseFilters(request.nextUrl.searchParams);
    const where = buildSalesWhere(filters);
    const summaryWhere = buildSalesWhere({ ...filters, status: undefined, overdueOnly: undefined });

    const [sales, summaryGroups, overdue] = await Promise.all([
      db.sale.findMany({
        where,
        orderBy: { soldAt: "desc" },
        take: 50,
        include: {
          items: {
            select: {
              quantity: true,
              unitPriceSnapshot: true,
              productNameSnapshot: true,
              flavorNameSnapshot: true,
            },
          },
        },
      }),
      db.sale.groupBy({
        by: ["status"],
        where: summaryWhere,
        _sum: { totalCents: true },
        _count: { _all: true },
      }),
      db.sale.aggregate({
        where: { AND: [summaryWhere, { status: "PENDING", paymentForecastDate: { lt: new Date() } }] },
        _sum: { totalCents: true },
        _count: { _all: true },
      }),
    ]);

    const byStatus = new Map(summaryGroups.map((g) => [g.status, g]));
    const pending = byStatus.get("PENDING");
    const paid = byStatus.get("PAID");

    return Response.json({
      sales,
      summary: {
        pendingCents: pending?._sum.totalCents ?? 0,
        pendingCount: pending?._count._all ?? 0,
        paidCents: paid?._sum.totalCents ?? 0,
        paidCount: paid?._count._all ?? 0,
        overdueCents: overdue._sum.totalCents ?? 0,
        overdueCount: overdue._count._all ?? 0,
      },
    });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}

type SaleItemInput = {
  itemId: string;
  productName: string;
  variantId: string | null;
  flavorName: string | null;
  quantity: number;
  unitPriceCents: number;
};

function calcDiscountCents(subtotal: number, type: "PERCENTAGE" | "FIXED" | null, value: number): number {
  if (!type || value <= 0) return 0;
  if (type === "PERCENTAGE") return Math.round((subtotal * value) / 100);
  return Math.min(value, subtotal);
}

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const customerId = typeof body.customerId === "string" && body.customerId ? body.customerId : null;
    const customerName =
      typeof body.customerName === "string" && body.customerName.trim() ? body.customerName.trim() : null;
    const soldAt = body.soldAt ? new Date(body.soldAt) : new Date();
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    const status: "PAID" | "PENDING" = body.status === "PENDING" ? "PENDING" : "PAID";
    const forecastPreset = typeof body.forecastPreset === "string" ? body.forecastPreset : null;
    const paymentForecastDate = body.forecastDate ? new Date(body.forecastDate) : null;
    const discountType: "PERCENTAGE" | "FIXED" | null =
      body.discountType === "PERCENTAGE" || body.discountType === "FIXED" ? body.discountType : null;
    const discountValue = discountType ? Math.max(0, Number(body.discountValue) || 0) : 0;

    const items = Array.isArray(body.items) ? (body.items as SaleItemInput[]) : [];
    if (items.length === 0) {
      return Response.json({ error: "Adicione pelo menos um item." }, { status: 400 });
    }

    const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    const discountCents = calcDiscountCents(subtotalCents, discountType, discountValue);
    const totalCents = subtotalCents - discountCents;

    const sale = await context.db.sale.create({
      data: {
        userId: context.userId,
        customerId,
        customerName,
        soldAt,
        notes,
        status,
        paidAt: status === "PAID" ? new Date() : null,
        paymentForecastDate: status === "PENDING" ? paymentForecastDate : null,
        forecastPreset: status === "PENDING" && forecastPreset ? forecastPreset : null,
        discountType,
        discountValue,
        totalCents,
        items: {
          create: items.map((item) => ({
            itemId: item.itemId,
            productNameSnapshot: item.productName,
            variantId: item.variantId,
            flavorNameSnapshot: item.flavorName,
            quantity: item.quantity,
            unitPriceSnapshot: item.unitPriceCents,
          })),
        },
      },
    });

    for (const item of items) {
      await context.db.stockMovement.create({
        data: {
          itemId: item.itemId,
          variantId: item.variantId,
          type: StockMovementType.SALE,
          quantity: -item.quantity,
          saleId: sale.id,
        },
      });
    }

    return Response.json({ sale: { id: sale.id, totalCents } }, { status: 201 });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
```

- [ ] **Step 4: Implementar `src/app/api/v1/sales/mark-paid/route.ts`**

```ts
import { NextRequest } from "next/server";
import { getMcpWorkspaceContext, assertMcpCanWrite, mcpErrorResponse } from "@/server/tenant/mcp-context";

export async function POST(request: NextRequest) {
  try {
    const context = await getMcpWorkspaceContext(request);
    assertMcpCanWrite(context);

    const body = await request.json();
    const saleId = typeof body.saleId === "string" ? body.saleId : null;
    const saleIds = Array.isArray(body.saleIds)
      ? body.saleIds.filter((id: unknown): id is string => typeof id === "string")
      : null;
    const customerId = typeof body.customerId === "string" ? body.customerId : null;

    if (!saleId && !saleIds && !customerId) {
      return Response.json({ error: "Informe saleId, saleIds ou customerId." }, { status: 400 });
    }

    const where = customerId
      ? { customerId, status: "PENDING" as const }
      : { id: { in: saleId ? [saleId] : saleIds! }, status: "PENDING" as const };

    const pending = await context.db.sale.aggregate({
      where,
      _sum: { totalCents: true },
      _count: { _all: true },
    });

    if (pending._count._all === 0) {
      return Response.json({ error: "Nenhuma venda pendente encontrada." }, { status: 404 });
    }

    await context.db.sale.updateMany({
      where,
      data: { status: "PAID", paidAt: new Date(), paymentForecastDate: null, forecastPreset: null },
    });

    return Response.json({ count: pending._count._all, totalCents: pending._sum.totalCents ?? 0 });
  } catch (e) {
    return mcpErrorResponse(e);
  }
}
```

- [ ] **Step 5: Rodar e confirmar que passam**

Run: `pnpm vitest run src/app/api/v1/sales`
Expected: PASS (7 testes)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/sales
git commit -m "feat(mcp): rotas /api/v1/sales (listar/criar vendas e marcar como pagas)"
```

---

## Depois deste plano

Com as 7 tasks acima concluídas, a API v1 está pronta e testada. O próximo passo é o plano irmão do `coolkies-mcp` (novo projeto, `/Users/ferrari/code/coolkies-mcp`), que consome exatamente essas rotas — ver `docs/superpowers/plans/2026-09-17-coolkies-mcp-server.md`.
