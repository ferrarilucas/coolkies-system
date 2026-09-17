# coolkies-mcp — servidor MCP remoto com OAuth

Data: 2026-09-17
Status: aguardando revisão do usuário

## Objetivo

Criar um servidor MCP remoto (`coolkies-mcp`, novo projeto em
`/Users/ferrari/code/coolkies-mcp`) que permite a um cliente MCP (Claude
Desktop, claude.ai custom connector) fazer login com a conta que o usuário
já tem no coolkies-system e, a partir daí, consultar e escrever dados de um
workspace: catálogo, lista de compras, clientes e vendas.

Não é só um novo projeto isolado — o coolkies-system (este repo) precisa
ganhar duas coisas: (1) virar um Authorization Server OAuth 2.1 e (2) expor
uma API HTTP nova, já que hoje toda a lógica de negócio vive em Server
Actions (`"use server"`, recebem `FormData`, leem sessão via
`next/headers()`), inacessíveis a um processo externo.

## Contexto atual (antes desta mudança)

- Autenticação é `better-auth` (`src/lib/auth.ts`) com login por e-mail/senha
  e Google OAuth. Sessão de navegador é um cookie assinado, resolvido por
  `auth.api.getSession({ headers })`.
- Multi-tenancy: um usuário pode pertencer a vários `Workspace` via `Member`.
  O "workspace ativo" de uma sessão de navegador fica em
  `Session.activeWorkspaceId` (nullable) — ver
  [schema.prisma](../../../prisma/schema.prisma) e
  [context.ts](../../../src/server/tenant/context.ts). Toda leitura/escrita
  passa por `getWorkspaceContext()`, que resolve o workspace ativo (com
  fallback pro primeiro `Member` do usuário) e se o plano permite escrita
  (`canWrite`, modo somente-leitura quando o trial/assinatura expira).
- Não existe nenhuma rota HTTP JSON hoje além de `/api/auth/*` (better-auth)
  e dois webhooks (Stripe, Interpix). Toda a UI chama Server Actions
  diretamente (`src/server/actions/*.ts`), que fazem `formData.get(...)` e
  não têm contrato JSON.
- `better-auth` v1.6.15 (já instalado) inclui o plugin `mcp` (que embrulha
  `oidc-provider`), capaz de transformar o app num Authorization Server
  OAuth 2.1 completo: discovery (`/.well-known/oauth-authorization-server`),
  dynamic client registration (`/mcp/register`), `/mcp/authorize`,
  `/mcp/token`, e validação de Bearer token (`getMcpSession`).
  Investigação em `node_modules/better-auth/dist/plugins/mcp/index.mjs`
  confirmou um ponto importante: **o token OAuth do MCP não é uma `Session`
  de navegador** — `getMcpSession` resolve o Bearer token direto contra a
  tabela própria `oauthAccessToken` (`userId`, `accessToken`, `scopes`, sem
  `activeWorkspaceId`). Portanto o mecanismo de "workspace ativo" hoje
  (coluna em `Session`) não se aplica a chamadas MCP — precisa de um
  mecanismo próprio (ver Decisão 3).

## Decisões

### 1. Duas partes: coolkies-system ganha uma API v1 + vira Authorization Server; coolkies-mcp é um tradutor fino

**coolkies-system** (este repo):
- Adiciona o plugin `mcp()` do better-auth em `src/lib/auth.ts`, reaproveitando
  as contas já existentes (login Google). Isso expõe automaticamente os
  endpoints de discovery/DCR/authorize/token sob `/api/auth/mcp/*` e
  `/.well-known/oauth-authorization-server`.
- Ganha uma API REST nova em `src/app/api/v1/*`, autenticada por Bearer token
  (validado com `auth.api.getMcpSession`), que expõe as mesmas operações que
  hoje só existem como Server Actions, em JSON.

**coolkies-mcp** (projeto novo):
- Fala MCP via **Streamable HTTP** (`@modelcontextprotocol/sdk`, TypeScript),
  servidor remoto — permite login OAuth de verdade a partir de um connector
  do Claude Desktop / claude.ai.
- Publica `/.well-known/oauth-protected-resource` apontando o Authorization
  Server para a URL do coolkies-system (RFC 9728).
- **Não tem banco de dados próprio e não valida token contra o Postgres.**
  Cada chamada de tool repassa o Bearer token do usuário para a API v1 do
  coolkies-system, que valida e executa. `coolkies-mcp` é um tradutor
  MCP ⇄ REST sem estado de negócio — fácil de re-deployar sem tocar em dados.
- Deploy: Vercel (Node runtime via Fluid Compute), como o resto do projeto.

Alternativas descartadas: (a) `coolkies-mcp` falar direto no Postgres via
Prisma — rejeitado porque duplicaria toda a lógica de validação/regras de
negócio (limite de plano, modo somente-leitura, etc.) que já vive no
coolkies-system; (b) stdio local — rejeitado porque OAuth com login via
navegador é o pedido explícito, e é o padrão de servidor remoto.

### 2. API v1 no coolkies-system: novas rotas, reaproveitando as queries/actions existentes

Todas sob `src/app/api/v1/*`, protegidas por um middleware/helper
`getMcpWorkspaceContext()` (novo, espelha `getWorkspaceContext()` em
[context.ts](../../../src/server/tenant/context.ts), mas resolve `userId` via
`auth.api.getMcpSession({ headers })` em vez de `auth.api.getSession`, e
resolve o workspace ativo via a tabela `McpWorkspaceContext` — decisão 3 —
em vez de `Session.activeWorkspaceId`). Reaproveita `scopedDb`,
`canWriteInWorkspace`, `db.member.findFirst` como hoje.

| Rota | Método | Reaproveita |
|---|---|---|
| `/api/v1/workspaces` | GET | `listUserWorkspaces` ([workspaces.ts](../../../src/server/tenant/workspaces.ts)) |
| `/api/v1/workspaces/active` | PUT | grava em `McpWorkspaceContext` (não em `Session`) |
| `/api/v1/items` | GET | consulta de catálogo ([items.ts](../../../src/server/queries/items.ts)) |
| `/api/v1/items` | POST | lógica de [`createItem`](../../../src/server/actions/items.ts) reescrita para receber JSON |
| `/api/v1/shopping-list` | GET | [shopping-list.ts](../../../src/server/queries/shopping-list.ts) |
| `/api/v1/shopping-list` | POST | lógica de [`createShoppingListItem`](../../../src/server/actions/shopping-list.ts) |
| `/api/v1/customers` | GET (`?q=`) | padrão de busca OR de [`getCustomersWithBalance`](../../../src/server/queries/customers.ts:105) (nome/e-mail/telefone) |
| `/api/v1/customers` | POST | lógica de [`createCustomer`](../../../src/server/actions/customers.ts:9) |
| `/api/v1/sales` | GET (filtros) | [`getSales`](../../../src/server/queries/sales.ts:67) + [`getSalesSummary`](../../../src/server/queries/sales.ts:113) |
| `/api/v1/sales` | POST | lógica de [`createSale`](../../../src/server/actions/sales.ts:37) |
| `/api/v1/sales/mark-paid` | POST | [`markAsPaid`](../../../src/server/actions/sales.ts:208) / [`markSalesAsPaid`](../../../src/server/actions/sales.ts:262) / [`markCustomerSalesAsPaid`](../../../src/server/actions/sales.ts:233), conforme o corpo (`saleId` \| `saleIds[]` \| `customerId`) |

As Server Actions existentes continuam existindo como estão (usadas pela UI);
as rotas novas reimplementam a mesma lógica de negócio em cima das mesmas
queries/Prisma, sem tentar chamar as Actions diretamente (elas são
`FormData`-first e cheias de `revalidatePath`, que não faz sentido fora de
uma requisição de página).

Todas as rotas de escrita respeitam `assertCanWrite()` (modo somente-leitura
do plano) e retornam erro 403 com a mesma mensagem já usada na UI.

### 3. Contexto de workspace: tabela própria, não `Session.activeWorkspaceId`

Nova tabela (migration escrita à mão, aplicada via `docker psql` em
`cookies` e `cookies_test`, conforme o padrão do projeto):

```prisma
model McpWorkspaceContext {
  userId      String   @id
  workspaceId String
  updatedAt   DateTime @updatedAt

  @@map("mcp_workspace_context")
}
```

Chave por `userId` (não por access token) — o token expira em 1h e é
renovado via refresh a cada hora; se o contexto morresse junto com o token,
o usuário teria que rechamar `set_active_workspace` toda hora. Guardando por
usuário, a escolha persiste entre conversas/renovações de token, do mesmo
jeito que hoje persiste entre abas de navegador (via `Session`, mas ali por
sessão de navegador — aqui, mais simples, por usuário).

Resolução do workspace ativo em `getMcpWorkspaceContext()`: busca
`McpWorkspaceContext` do usuário → confere que ele ainda é `Member` daquele
workspace → se não houver linha ou a associação não for mais válida, cai
pro primeiro `Member` do usuário (mesmo fallback de `getWorkspaceContext()`).
Se o usuário não pertencer a nenhum workspace, erro claro orientando a criar
um pela UI (criação de workspace fica fora do escopo do MCP nesta v1).

## Ferramentas (tools) do coolkies-mcp — v1

Todas as tools abaixo operam implicitamente sobre o **workspace ativo**
(resolvido como na decisão 3) — nenhuma delas recebe `workspaceId` como
parâmetro.

1. **`list_workspaces`** — workspaces do usuário + papel (role) + qual é o
   ativo no momento.
2. **`set_active_workspace`** — troca o workspace ativo (`workspaceId`).
3. **`list_items`** — lista o catálogo (filtro opcional por nome/ativo).
4. **`create_item`** — cria item no catálogo.
5. **`list_shopping_list_items`** — lista a lista de compras.
6. **`add_shopping_list_item`** — adiciona item à lista de compras.
7. **`list_customers`** — busca clientes por nome, telefone ou e-mail
   (`q` opcional).
8. **`create_customer`** — cria cliente (`name` obrigatório; `email`,
   `phone`, `sector`, `notes` opcionais).
9. **`list_sales`** — filtros: `status` (PAID/PENDING), `q`, `customerId`,
   `from`/`to`, `forecastFrom`/`forecastTo`, `overdueOnly` — espelha
   `SalesFilters` ([sales.ts:10](../../../src/server/queries/sales.ts:10)).
   Retorna também o resumo agregado (`pendingCents`, `overdueCents`, etc.)
   pra responder direto "quanto o cliente X deve" sem o modelo precisar
   somar item por item.
10. **`create_sale`** — registra uma venda com um ou mais itens já inclusos
    (não existe "adicionar item a venda existente" no domínio — uma venda
    sempre nasce com sua lista completa de itens).
11. **`mark_sales_as_paid`** — aceita `saleId` único, `saleIds[]` ou
    `customerId` (marca todas as pendentes daquele cliente).

Erros de negócio (venda não encontrada, modo somente-leitura, e-mail de
cliente duplicado, código de convite inválido etc.) voltam como erro de tool
MCP com a mesma mensagem em português já usada na UI — sem tradução ou
reinterpretação.

## Fluxo de autenticação (ponta a ponta)

1. Cliente MCP (ex. Claude Desktop) tenta chamar uma tool no coolkies-mcp sem
   token → recebe 401 com `WWW-Authenticate: Bearer
   resource_metadata="https://coolkies-mcp.../.well-known/oauth-protected-resource"`.
2. Cliente busca esse metadata, descobre que o Authorization Server é o
   coolkies-system, faz dynamic client registration (`/mcp/register`) e abre
   o navegador no `/mcp/authorize` do coolkies-system.
3. Usuário faz login (ou já está logado) com a conta Google que já usa no
   app, autoriza o client MCP.
4. coolkies-system emite `code` → cliente troca por `access_token` +
   `refresh_token` no `/mcp/token`.
5. Cliente MCP chama `coolkies-mcp` com `Authorization: Bearer <token>`.
6. Cada tool do `coolkies-mcp` repassa esse Bearer pra API v1 do
   coolkies-system, que valida via `getMcpSession` e resolve o workspace
   ativo via `McpWorkspaceContext`.

## Testes

- **coolkies-system**: testes de rota para cada endpoint `/api/v1/*` (feliz e
  erro: sem token, token inválido, sem permissão de escrita, sem
  `McpWorkspaceContext` ainda configurado). Seguem o padrão de teste já usado
  no projeto (`*.test.ts` ao lado do arquivo, Vitest).
- **coolkies-mcp**: testes de cada tool com a API v1 mockada (contrato de
  entrada/saída), e um teste de integração do fluxo OAuth completo contra um
  coolkies-system local (`docker compose up`, banco `cookies_test`).

## Fora de escopo (v1)

- Criar workspace, gerenciar membros/convites, edição de item/cliente/venda
  existente, exclusão de qualquer entidade, produção/receitas/estoque,
  compras/fornecedores. Tudo isso pode virar uma v2 se fizer sentido depois
  que o fluxo básico (ler + adicionar) estiver validado em uso real.
- Multi-cliente MCP simultâneo por usuário com workspaces ativos diferentes
  por cliente — nesta v1, o workspace ativo é global por usuário, não por
  `clientId` do OAuth.
