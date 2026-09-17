# coolkies-mcp — servidor MCP remoto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o projeto novo `coolkies-mcp` (em `/Users/ferrari/code/coolkies-mcp`): um servidor MCP remoto (Streamable HTTP), autenticado via OAuth contra o coolkies-system, que expõe 11 tools traduzindo chamadas MCP para a API `/api/v1/*` do coolkies-system.

**Architecture:** Hono app com uma única rota `/mcp` (todos os métodos) que, a cada requisição, extrai o Bearer token do header `Authorization`, cria um `McpServer` + `WebStandardStreamableHTTPServerTransport` novos (modo *stateless*, cópia do exemplo oficial do SDK) e injeta o token como `authInfo` — nenhum estado de sessão MCP é guardado no servidor. Cada tool é uma função pura `(token, args) => CallToolResult` que só faz um `fetch` para `COOLKIES_BASE_URL + /api/v1/...`; o `registerTool` é só a cola que extrai o token de `extra.authInfo` e chama a função. Sem banco de dados próprio.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk` 1.30, Hono 4, Zod 4, `@hono/node-server` (dev local), deploy Vercel (Node runtime).

**Spec:** [docs/superpowers/specs/2026-09-17-coolkies-mcp-design.md](../specs/2026-09-17-coolkies-mcp-design.md)
**Depende de:** [docs/superpowers/plans/2026-09-17-coolkies-mcp-api.md](./2026-09-17-coolkies-mcp-api.md) (as 7 tasks da API `/api/v1/*` no coolkies-system precisam estar prontas — em produção para uso real, mas os testes deste plano rodam com `fetch` mockado e não precisam do coolkies-system rodando).

## Global Constraints

- Projeto novo, fora do repositório coolkies-system: `/Users/ferrari/code/coolkies-mcp`.
- Use **pnpm**, nunca `npm`/`yarn`.
- **Sem comentários inline no código** — nenhum `//` explicando o óbvio.
- Toda mensagem de erro voltada a humano é em **português**.
- Nenhuma tool acessa banco de dados ou valida token sozinha — tudo passa pela API `/api/v1/*` do coolkies-system via `callCoolkiesApi`.
- Todas as tools operam sobre o **workspace ativo** (resolvido do lado do coolkies-system); nenhuma tool recebe `workspaceId` como parâmetro.
- Versões pinadas para casar com o coolkies-system: `typescript@^5.7.2`, `vitest@^2.1.9`, `tsx@^4.19.2`, `@types/node@^22.10.0`.

---

### Task B1: Scaffold do projeto

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/app.ts`
- Create: `src/index.ts`
- Create: `api/index.ts`
- Create: `vercel.json`
- Test: `src/app.test.ts`

**Interfaces:**
- Produces: `app` (instância Hono, exportada de `src/app.ts`) — consumida por todas as tasks seguintes (cada uma adiciona rotas a ela) e pelos dois entrypoints (`src/index.ts` local, `api/index.ts` Vercel).

- [ ] **Step 1: Criar a pasta e inicializar os arquivos de configuração**

```bash
mkdir -p /Users/ferrari/code/coolkies-mcp/src /Users/ferrari/code/coolkies-mcp/api
cd /Users/ferrari/code/coolkies-mcp
git init
```

Crie `package.json`:

```json
{
  "name": "coolkies-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "hono": "^4.13.8",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@hono/node-server": "^2.1.1",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.9"
  }
}
```

Crie `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "api"]
}
```

Crie `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

Crie `.env.example`:

```
COOLKIES_BASE_URL="http://localhost:3000"
MCP_PUBLIC_URL="http://localhost:3100"
PORT=3100
```

Crie `.gitignore`:

```
node_modules
dist
.env
```

- [ ] **Step 2: Instalar dependências**

```bash
cd /Users/ferrari/code/coolkies-mcp && pnpm install
```

- [ ] **Step 3: Escrever o teste do health check (vai falhar — `src/app.ts` ainda não existe)**

Crie `src/app.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("GET /health", () => {
  it("responde ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `pnpm vitest run src/app.test.ts`
Expected: FAIL — `Cannot find module './app'`

- [ ] **Step 5: Implementar `src/app.ts`, `src/index.ts`, `api/index.ts`, `vercel.json`**

Crie `src/app.ts`:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "mcp-session-id", "mcp-protocol-version"],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version", "www-authenticate"],
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));
```

Crie `src/index.ts`:

```ts
import { serve } from "@hono/node-server";
import { app } from "./app";

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3100;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`coolkies-mcp ouvindo em http://localhost:${info.port}`);
});
```

Crie `api/index.ts`:

```ts
import { handle } from "hono/vercel";
import { app } from "../src/app";

export const GET = handle(app);
export const POST = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
```

Crie `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/mcp", "destination": "/api" },
    { "source": "/health", "destination": "/api" },
    { "source": "/.well-known/oauth-protected-resource", "destination": "/api" }
  ]
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `pnpm vitest run src/app.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/ferrari/code/coolkies-mcp
git add -A
git commit -m "chore: scaffold do coolkies-mcp (Hono + health check)"
```

---

### Task B2: Cliente HTTP para a API do coolkies-system + metadata OAuth

**Files:**
- Create: `src/lib/coolkies-client.ts`
- Create: `src/lib/tool-result.ts`
- Test: `src/lib/coolkies-client.test.ts`
- Test: `src/lib/tool-result.test.ts`
- Modify: `src/app.ts` (rota `/.well-known/oauth-protected-resource`)
- Test: `src/app.test.ts` (adiciona describe da nova rota)

**Interfaces:**
- Consumes: nada de tasks anteriores além de `app` (Task B1).
- Produces: `callCoolkiesApi(token: string, path: string, options?: { method?: string; body?: unknown }): Promise<unknown>` (lança `CoolkiesApiError`); `toolJson(data: unknown): CallToolResult`; `toolError(e: unknown): CallToolResult`. Usadas por todas as tools (Tasks B3-B7).

- [ ] **Step 1: Escrever os testes (vão falhar — os módulos ainda não existem)**

Crie `src/lib/coolkies-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { callCoolkiesApi, CoolkiesApiError } from "./coolkies-client";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COOLKIES_BASE_URL;
});

describe("callCoolkiesApi", () => {
  it("chama a URL certa com o Bearer token e retorna o JSON", async () => {
    process.env.COOLKIES_BASE_URL = "http://coolkies.test";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://coolkies.test/api/v1/items");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer abc123");
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const data = await callCoolkiesApi("abc123", "/api/v1/items");
    expect(data).toEqual({ items: [] });
  });

  it("lança CoolkiesApiError com a mensagem do corpo quando a resposta não é ok", async () => {
    process.env.COOLKIES_BASE_URL = "http://coolkies.test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Nome obrigatório." }), { status: 400 })),
    );

    await expect(callCoolkiesApi("abc123", "/api/v1/items", { method: "POST", body: {} })).rejects.toThrow(
      "Nome obrigatório.",
    );
  });

  it("usa uma mensagem genérica quando o corpo do erro não tem campo error", async () => {
    process.env.COOLKIES_BASE_URL = "http://coolkies.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

    await expect(callCoolkiesApi("abc123", "/api/v1/items")).rejects.toThrow(CoolkiesApiError);
  });
});
```

Crie `src/lib/tool-result.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toolError, toolJson } from "./tool-result";
import { CoolkiesApiError } from "./coolkies-client";

describe("toolJson", () => {
  it("serializa o valor em um bloco de texto", () => {
    const result = toolJson({ a: 1 });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ a: 1 }, null, 2) }]);
    expect(result.isError).toBeUndefined();
  });
});

describe("toolError", () => {
  it("usa a mensagem de um CoolkiesApiError e marca isError", () => {
    const result = toolError(new CoolkiesApiError(404, "Venda não encontrada."));
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Venda não encontrada." }]);
  });

  it("usa uma mensagem genérica para erros desconhecidos", () => {
    const result = toolError("algo estranho");
    expect(result.content).toEqual([{ type: "text", text: "Erro inesperado." }]);
  });
});
```

Adicione ao `src/app.test.ts` (Task B1):

```ts
describe("GET /.well-known/oauth-protected-resource", () => {
  it("aponta o authorization server pro coolkies-system", async () => {
    process.env.COOLKIES_BASE_URL = "http://coolkies.test";
    process.env.MCP_PUBLIC_URL = "http://mcp.test";

    const res = await app.request("/.well-known/oauth-protected-resource");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resource: "http://mcp.test",
      authorization_servers: ["http://coolkies.test"],
      bearer_methods_supported: ["header"],
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run`
Expected: FAIL — `Cannot find module './coolkies-client'` / `Cannot find module './tool-result'`; a rota `.well-known` retorna 404.

- [ ] **Step 3: Implementar `src/lib/coolkies-client.ts`**

```ts
export class CoolkiesApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "CoolkiesApiError";
  }
}

type CallOptions = {
  method?: string;
  body?: unknown;
};

export async function callCoolkiesApi(
  token: string,
  path: string,
  options: CallOptions = {},
): Promise<unknown> {
  const baseUrl = process.env.COOLKIES_BASE_URL ?? "http://localhost:3000";

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Erro ao chamar ${path} (HTTP ${response.status}).`;
    throw new CoolkiesApiError(response.status, message);
  }

  return data;
}
```

- [ ] **Step 4: Implementar `src/lib/tool-result.ts`**

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CoolkiesApiError } from "./coolkies-client";

export function toolJson(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function toolError(e: unknown): CallToolResult {
  const message =
    e instanceof CoolkiesApiError ? e.message : e instanceof Error ? e.message : "Erro inesperado.";
  return { content: [{ type: "text", text: message }], isError: true };
}
```

- [ ] **Step 5: Adicionar a rota `/.well-known/oauth-protected-resource` em `src/app.ts`**

```ts
app.get("/.well-known/oauth-protected-resource", (c) => {
  const coolkiesBaseUrl = process.env.COOLKIES_BASE_URL ?? "http://localhost:3000";
  const mcpPublicUrl = process.env.MCP_PUBLIC_URL ?? "http://localhost:3100";
  return c.json({
    resource: mcpPublicUrl,
    authorization_servers: [coolkiesBaseUrl],
    bearer_methods_supported: ["header"],
  });
});
```

- [ ] **Step 6: Rodar e confirmar que passam**

Run: `pnpm vitest run`
Expected: PASS (todos os testes)

- [ ] **Step 7: Commit**

```bash
git add src/lib src/app.ts src/app.test.ts
git commit -m "feat: cliente HTTP da API do coolkies-system e resource metadata OAuth"
```

---

### Task B3: Bootstrap do McpServer + tools de workspace

**Files:**
- Create: `src/tools/auth.ts`
- Create: `src/tools/workspaces.ts`
- Create: `src/tools/index.ts`
- Modify: `src/app.ts` (rota `/mcp`)
- Test: `src/tools/workspaces.test.ts`
- Test: `src/mcp-e2e.test.ts`

**Interfaces:**
- Consumes: `callCoolkiesApi`, `CoolkiesApiError` de `./lib/coolkies-client`; `toolJson`, `toolError` de `./lib/tool-result` (Task B2); `app` de `./app` (Task B1).
- Produces: `requireToken(extra): string` (`src/tools/auth.ts`, usada por todas as tools das Tasks B4-B7); `registerTools(server: McpServer): void` (`src/tools/index.ts`, chamada pela rota `/mcp`; cada task seguinte adiciona uma chamada `registerXTools(server)` a ela); rota `/mcp` funcional em `src/app.ts`.

- [ ] **Step 1: Escrever os testes unitários das tools de workspace (vão falhar — módulos não existem)**

Crie `src/tools/workspaces.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { listWorkspacesHandler, setActiveWorkspaceHandler } from "./workspaces";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listWorkspacesHandler", () => {
  it("repassa a resposta da API do coolkies-system", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ workspaces: [{ id: "w1", name: "Loja", slug: "loja", role: "OWNER", active: true }] }),
          { status: 200 },
        ),
      ),
    );

    const result = await listWorkspacesHandler("tok");

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text).workspaces).toHaveLength(1);
  });

  it("retorna isError quando a API falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Token inválido." }), { status: 401 })),
    );

    const result = await listWorkspacesHandler("tok-invalido");

    expect(result.isError).toBe(true);
  });
});

describe("setActiveWorkspaceHandler", () => {
  it("envia PUT com o workspaceId no corpo", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/workspaces/active");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({ workspaceId: "w2" });
      return new Response(JSON.stringify({ id: "w2", name: "Loja 2", slug: "loja-2", role: "MEMBER" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await setActiveWorkspaceHandler("tok", { workspaceId: "w2" });

    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/tools/workspaces.test.ts`
Expected: FAIL — `Cannot find module './workspaces'`

- [ ] **Step 3: Implementar `src/tools/auth.ts`**

```ts
export function requireToken(extra: { authInfo?: { token: string } }): string {
  if (!extra.authInfo?.token) throw new Error("Token ausente.");
  return extra.authInfo.token;
}
```

- [ ] **Step 4: Implementar `src/tools/workspaces.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callCoolkiesApi } from "../lib/coolkies-client";
import { toolError, toolJson } from "../lib/tool-result";
import { requireToken } from "./auth";

export async function listWorkspacesHandler(token: string): Promise<CallToolResult> {
  try {
    const data = await callCoolkiesApi(token, "/api/v1/workspaces");
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export async function setActiveWorkspaceHandler(
  token: string,
  args: { workspaceId: string },
): Promise<CallToolResult> {
  try {
    const data = await callCoolkiesApi(token, "/api/v1/workspaces/active", {
      method: "PUT",
      body: { workspaceId: args.workspaceId },
    });
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "list_workspaces",
    {
      title: "Listar workspaces",
      description: "Lista os workspaces do usuário logado, com o papel em cada um e qual está ativo.",
    },
    async (extra) => listWorkspacesHandler(requireToken(extra)),
  );

  server.registerTool(
    "set_active_workspace",
    {
      title: "Trocar workspace ativo",
      description: "Define qual workspace fica ativo para as próximas chamadas de outras tools.",
      inputSchema: { workspaceId: z.string().describe("ID do workspace (retornado por list_workspaces)") },
    },
    async ({ workspaceId }, extra) => setActiveWorkspaceHandler(requireToken(extra), { workspaceId }),
  );
}
```

- [ ] **Step 5: Implementar `src/tools/index.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkspaceTools } from "./workspaces";

export function registerTools(server: McpServer): void {
  registerWorkspaceTools(server);
}
```

- [ ] **Step 6: Adicionar a rota `/mcp` em `src/app.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { registerTools } from "./tools";
```

(adicione esses imports no topo de `src/app.ts`, junto aos de `hono`)

```ts
function unauthorizedResponse(): Response {
  const mcpPublicUrl = process.env.MCP_PUBLIC_URL ?? "http://localhost:3100";
  return new Response(JSON.stringify({ error: "Unauthorized: token ausente." }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${mcpPublicUrl}/.well-known/oauth-protected-resource"`,
    },
  });
}

function createServer(): McpServer {
  const server = new McpServer({ name: "coolkies-mcp", version: "0.1.0" });
  registerTools(server);
  return server;
}

app.all("/mcp", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return unauthorizedResponse();

  const authInfo: AuthInfo = { token, clientId: "coolkies-mcp-client", scopes: [] };
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createServer();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw, { authInfo });
});
```

(adicione esse bloco no final de `src/app.ts`, depois da rota `/.well-known/oauth-protected-resource`)

- [ ] **Step 7: Rodar os testes unitários e confirmar que passam**

Run: `pnpm vitest run src/tools/workspaces.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 8: Escrever o teste end-to-end da rota `/mcp` (vai falhar até o Step 6 estar correto — rode-o agora para validar a integração real do SDK)**

Crie `src/mcp-e2e.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { app } from "./app";

let server: Server;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env.COOLKIES_BASE_URL = "http://coolkies.test";
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://localhost:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/mcp end-to-end", () => {
  it("chama list_workspaces autenticado e recebe a resposta encaminhada pela API do coolkies-system", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("http://coolkies.test")) {
        return new Response(
          JSON.stringify({ workspaces: [{ id: "w1", name: "Loja", slug: "loja", role: "OWNER", active: true }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return realFetch(input, init);
    });

    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer test-token" } },
    });
    await client.connect(transport);

    const result = await client.callTool({ name: "list_workspaces", arguments: {} });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({
      workspaces: [{ id: "w1", name: "Loja", slug: "loja", role: "OWNER", active: true }],
    });

    await client.close();
  });

  it("recusa a conexão quando não há Authorization", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));

    await expect(client.connect(transport)).rejects.toThrow();
  });
});
```

- [ ] **Step 9: Rodar todos os testes e confirmar que passam**

Run: `pnpm vitest run`
Expected: PASS (todos). Se o teste end-to-end falhar por causa de algum detalhe da API do SDK (`registerTool`, `handleRequest`, `StreamableHTTPClientTransport`), ajuste a implementação do Step 6 até passar — este teste é a prova de que o SDK está corretamente conectado, use as mensagens de erro para corrigir a integração.

- [ ] **Step 10: Commit**

```bash
git add src/tools src/app.ts src/mcp-e2e.test.ts
git commit -m "feat: bootstrap do McpServer, rota /mcp e tools de workspace"
```

---

### Task B4: Tools de catálogo (list_items, create_item)

**Files:**
- Create: `src/tools/items.ts`
- Modify: `src/tools/index.ts`
- Test: `src/tools/items.test.ts`

**Interfaces:**
- Consumes: `callCoolkiesApi` (Task B2); `toolJson`, `toolError` (Task B2); `requireToken` (Task B3).
- Produces: `registerItemTools(server: McpServer): void`, registrada em `registerTools` (Task B3).

- [ ] **Step 1: Escrever os testes**

Crie `src/tools/items.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createItemHandler, listItemsHandler } from "./items";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listItemsHandler", () => {
  it("repassa a lista de itens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [{ id: "i1", name: "Açúcar" }] }), { status: 200 })),
    );

    const result = await listItemsHandler("tok");

    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content[0] as { text: string }).text).items).toHaveLength(1);
  });
});

describe("createItemHandler", () => {
  it("envia POST com os campos do item", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/items");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "Refrigerante",
        unit: "UN",
        sellable: true,
        productionInput: false,
      });
      return new Response(JSON.stringify({ item: { id: "i2" } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createItemHandler("tok", {
      name: "Refrigerante",
      unit: "UN",
      sellable: true,
      productionInput: false,
    });

    expect(result.isError).toBeFalsy();
  });

  it("retorna isError quando a API recusa (ex: sem papel OWNER/ADMIN)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Não autorizado." }), { status: 403 })),
    );

    const result = await createItemHandler("tok", {
      name: "Item",
      unit: "UN",
      sellable: true,
      productionInput: false,
    });

    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/tools/items.test.ts`
Expected: FAIL — `Cannot find module './items'`

- [ ] **Step 3: Implementar `src/tools/items.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callCoolkiesApi } from "../lib/coolkies-client";
import { toolError, toolJson } from "../lib/tool-result";
import { requireToken } from "./auth";

export async function listItemsHandler(token: string): Promise<CallToolResult> {
  try {
    const data = await callCoolkiesApi(token, "/api/v1/items");
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export type CreateItemArgs = {
  name: string;
  unit: "G" | "ML" | "UN";
  sellable: boolean;
  productionInput: boolean;
  minStock?: number;
};

export async function createItemHandler(token: string, args: CreateItemArgs): Promise<CallToolResult> {
  try {
    const data = await callCoolkiesApi(token, "/api/v1/items", { method: "POST", body: args });
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export function registerItemTools(server: McpServer): void {
  server.registerTool(
    "list_items",
    { title: "Listar catálogo", description: "Lista os itens do catálogo do workspace ativo." },
    async (extra) => listItemsHandler(requireToken(extra)),
  );

  server.registerTool(
    "create_item",
    {
      title: "Criar item no catálogo",
      description: "Cria um item novo no catálogo do workspace ativo. Requer papel OWNER ou ADMIN.",
      inputSchema: {
        name: z.string().describe("Nome do item"),
        unit: z.enum(["G", "ML", "UN"]).describe("Unidade base do item"),
        sellable: z.boolean().describe("Se o item pode ser vendido (exige unit = UN)"),
        productionInput: z.boolean().describe("Se o item pode ser usado como insumo de produção"),
        minStock: z.number().optional().describe("Estoque mínimo (opcional)"),
      },
    },
    async (args, extra) => createItemHandler(requireToken(extra), args),
  );
}
```

- [ ] **Step 4: Registrar em `src/tools/index.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkspaceTools } from "./workspaces";
import { registerItemTools } from "./items";

export function registerTools(server: McpServer): void {
  registerWorkspaceTools(server);
  registerItemTools(server);
}
```

- [ ] **Step 5: Rodar e confirmar que passam**

Run: `pnpm vitest run`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add src/tools/items.ts src/tools/index.ts src/tools/items.test.ts
git commit -m "feat: tools list_items e create_item"
```

---

### Task B5: Tools de lista de compras (list_shopping_list_items, add_shopping_list_item)

**Files:**
- Create: `src/tools/shopping-list.ts`
- Modify: `src/tools/index.ts`
- Test: `src/tools/shopping-list.test.ts`

**Interfaces:**
- Consumes: `callCoolkiesApi`, `toolJson`, `toolError` (Task B2); `requireToken` (Task B3).
- Produces: `registerShoppingListTools(server: McpServer): void`, registrada em `registerTools`.

- [ ] **Step 1: Escrever os testes**

Crie `src/tools/shopping-list.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { addShoppingListItemHandler, listShoppingListItemsHandler } from "./shopping-list";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listShoppingListItemsHandler", () => {
  it("repassa a lista de itens pendentes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [{ id: "s1", label: "Farinha" }] }), { status: 200 })),
    );

    const result = await listShoppingListItemsHandler("tok");

    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content[0] as { text: string }).text).items).toHaveLength(1);
  });
});

describe("addShoppingListItemHandler", () => {
  it("envia POST com a descrição do item", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/shopping-list");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ label: "Ovos", quantity: 30, unit: "UN" });
      return new Response(JSON.stringify({ item: { id: "s2" } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await addShoppingListItemHandler("tok", { label: "Ovos", quantity: 30, unit: "UN" });

    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/tools/shopping-list.test.ts`
Expected: FAIL — `Cannot find module './shopping-list'`

- [ ] **Step 3: Implementar `src/tools/shopping-list.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callCoolkiesApi } from "../lib/coolkies-client";
import { toolError, toolJson } from "../lib/tool-result";
import { requireToken } from "./auth";

export async function listShoppingListItemsHandler(token: string): Promise<CallToolResult> {
  try {
    const data = await callCoolkiesApi(token, "/api/v1/shopping-list");
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export type AddShoppingListItemArgs = {
  label: string;
  itemId?: string;
  quantity?: number;
  unit?: "G" | "ML" | "UN";
};

export async function addShoppingListItemHandler(
  token: string,
  args: AddShoppingListItemArgs,
): Promise<CallToolResult> {
  try {
    const data = await callCoolkiesApi(token, "/api/v1/shopping-list", { method: "POST", body: args });
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export function registerShoppingListTools(server: McpServer): void {
  server.registerTool(
    "list_shopping_list_items",
    { title: "Listar lista de compras", description: "Lista os itens pendentes na lista de compras do workspace ativo." },
    async (extra) => listShoppingListItemsHandler(requireToken(extra)),
  );

  server.registerTool(
    "add_shopping_list_item",
    {
      title: "Adicionar item à lista de compras",
      description: "Adiciona um item à lista de compras do workspace ativo.",
      inputSchema: {
        label: z.string().describe("Descrição do item"),
        itemId: z.string().optional().describe("ID de um item do catálogo, se aplicável"),
        quantity: z.number().optional().describe("Quantidade desejada"),
        unit: z.enum(["G", "ML", "UN"]).optional().describe("Unidade da quantidade"),
      },
    },
    async (args, extra) => addShoppingListItemHandler(requireToken(extra), args),
  );
}
```

- [ ] **Step 4: Registrar em `src/tools/index.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkspaceTools } from "./workspaces";
import { registerItemTools } from "./items";
import { registerShoppingListTools } from "./shopping-list";

export function registerTools(server: McpServer): void {
  registerWorkspaceTools(server);
  registerItemTools(server);
  registerShoppingListTools(server);
}
```

- [ ] **Step 5: Rodar e confirmar que passam**

Run: `pnpm vitest run`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add src/tools/shopping-list.ts src/tools/index.ts src/tools/shopping-list.test.ts
git commit -m "feat: tools list_shopping_list_items e add_shopping_list_item"
```

---

### Task B6: Tools de clientes (list_customers, create_customer)

**Files:**
- Create: `src/tools/customers.ts`
- Modify: `src/tools/index.ts`
- Test: `src/tools/customers.test.ts`

**Interfaces:**
- Consumes: `callCoolkiesApi`, `toolJson`, `toolError` (Task B2); `requireToken` (Task B3).
- Produces: `registerCustomerTools(server: McpServer): void`, registrada em `registerTools`.

- [ ] **Step 1: Escrever os testes**

Crie `src/tools/customers.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCustomerHandler, listCustomersHandler } from "./customers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listCustomersHandler", () => {
  it("inclui o termo de busca na query string", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/api/v1/customers?q=maria");
      return new Response(JSON.stringify({ customers: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await listCustomersHandler("tok", { q: "maria" });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sem termo de busca não inclui query string", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/api/v1/customers");
      expect(url).not.toContain("?");
      return new Response(JSON.stringify({ customers: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await listCustomersHandler("tok", {});
  });
});

describe("createCustomerHandler", () => {
  it("envia POST com os campos do cliente", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/customers");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ name: "Nova Cliente", email: "nova@example.com" });
      return new Response(JSON.stringify({ customer: { id: "c1" } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCustomerHandler("tok", { name: "Nova Cliente", email: "nova@example.com" });

    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/tools/customers.test.ts`
Expected: FAIL — `Cannot find module './customers'`

- [ ] **Step 3: Implementar `src/tools/customers.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callCoolkiesApi } from "../lib/coolkies-client";
import { toolError, toolJson } from "../lib/tool-result";
import { requireToken } from "./auth";

export async function listCustomersHandler(token: string, args: { q?: string }): Promise<CallToolResult> {
  try {
    const query = args.q ? `?q=${encodeURIComponent(args.q)}` : "";
    const data = await callCoolkiesApi(token, `/api/v1/customers${query}`);
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export type CreateCustomerArgs = {
  name: string;
  email?: string;
  phone?: string;
  sector?: string;
  notes?: string;
};

export async function createCustomerHandler(token: string, args: CreateCustomerArgs): Promise<CallToolResult> {
  try {
    const data = await callCoolkiesApi(token, "/api/v1/customers", { method: "POST", body: args });
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export function registerCustomerTools(server: McpServer): void {
  server.registerTool(
    "list_customers",
    {
      title: "Buscar clientes",
      description:
        "Busca clientes do workspace ativo por nome, telefone ou e-mail. Sem filtro, lista os mais recentes.",
      inputSchema: { q: z.string().optional().describe("Termo de busca: nome, telefone ou e-mail") },
    },
    async (args, extra) => listCustomersHandler(requireToken(extra), args),
  );

  server.registerTool(
    "create_customer",
    {
      title: "Criar cliente",
      description: "Cria um cliente novo no workspace ativo.",
      inputSchema: {
        name: z.string().describe("Nome do cliente"),
        email: z.string().optional().describe("E-mail (opcional)"),
        phone: z.string().optional().describe("Telefone (opcional)"),
        sector: z.string().optional().describe("Setor/categoria (opcional)"),
        notes: z.string().optional().describe("Observações (opcional)"),
      },
    },
    async (args, extra) => createCustomerHandler(requireToken(extra), args),
  );
}
```

- [ ] **Step 4: Registrar em `src/tools/index.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkspaceTools } from "./workspaces";
import { registerItemTools } from "./items";
import { registerShoppingListTools } from "./shopping-list";
import { registerCustomerTools } from "./customers";

export function registerTools(server: McpServer): void {
  registerWorkspaceTools(server);
  registerItemTools(server);
  registerShoppingListTools(server);
  registerCustomerTools(server);
}
```

- [ ] **Step 5: Rodar e confirmar que passam**

Run: `pnpm vitest run`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add src/tools/customers.ts src/tools/index.ts src/tools/customers.test.ts
git commit -m "feat: tools list_customers e create_customer"
```

---

### Task B7: Tools de vendas (list_sales, create_sale, mark_sales_as_paid)

**Files:**
- Create: `src/tools/sales.ts`
- Modify: `src/tools/index.ts`
- Test: `src/tools/sales.test.ts`

**Interfaces:**
- Consumes: `callCoolkiesApi`, `toolJson`, `toolError` (Task B2); `requireToken` (Task B3).
- Produces: `registerSalesTools(server: McpServer): void`, registrada em `registerTools`. Com esta task, `registerTools` (e portanto o servidor MCP) expõe as 11 tools do escopo v1.

- [ ] **Step 1: Escrever os testes**

Crie `src/tools/sales.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSaleHandler, listSalesHandler, markSalesAsPaidHandler } from "./sales";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listSalesHandler", () => {
  it("monta a query string a partir dos filtros informados", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("status=PENDING");
      expect(url).toContain("customerId=c1");
      expect(url).not.toContain("q=");
      return new Response(JSON.stringify({ sales: [], summary: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await listSalesHandler("tok", { status: "PENDING", customerId: "c1" });
  });
});

describe("createSaleHandler", () => {
  it("envia POST com os itens da venda", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/sales");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body.items).toHaveLength(1);
      return new Response(JSON.stringify({ sale: { id: "s1", totalCents: 3000 } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createSaleHandler("tok", {
      customerName: "Cliente Avulso",
      items: [{ itemId: "i1", productName: "Bolo", quantity: 2, unitPriceCents: 1500 }],
    });

    expect(result.isError).toBeFalsy();
  });
});

describe("markSalesAsPaidHandler", () => {
  it("envia POST com customerId", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/sales/mark-paid");
      expect(JSON.parse(String(init?.body))).toEqual({ customerId: "c1" });
      return new Response(JSON.stringify({ count: 2, totalCents: 5000 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await markSalesAsPaidHandler("tok", { customerId: "c1" });

    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm vitest run src/tools/sales.test.ts`
Expected: FAIL — `Cannot find module './sales'`

- [ ] **Step 3: Implementar `src/tools/sales.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callCoolkiesApi } from "../lib/coolkies-client";
import { toolError, toolJson } from "../lib/tool-result";
import { requireToken } from "./auth";

export type ListSalesArgs = {
  status?: "PAID" | "PENDING";
  q?: string;
  customerId?: string;
  from?: string;
  to?: string;
  forecastFrom?: string;
  forecastTo?: string;
  overdueOnly?: boolean;
};

export async function listSalesHandler(token: string, args: ListSalesArgs): Promise<CallToolResult> {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";
    const data = await callCoolkiesApi(token, `/api/v1/sales${query}`);
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export type CreateSaleArgs = {
  customerId?: string;
  customerName?: string;
  soldAt?: string;
  notes?: string;
  status?: "PAID" | "PENDING";
  forecastDate?: string;
  discountType?: "PERCENTAGE" | "FIXED";
  discountValue?: number;
  items: Array<{
    itemId: string;
    productName: string;
    variantId?: string;
    flavorName?: string;
    quantity: number;
    unitPriceCents: number;
  }>;
};

export async function createSaleHandler(token: string, args: CreateSaleArgs): Promise<CallToolResult> {
  try {
    const data = await callCoolkiesApi(token, "/api/v1/sales", { method: "POST", body: args });
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export type MarkSalesAsPaidArgs = {
  saleId?: string;
  saleIds?: string[];
  customerId?: string;
};

export async function markSalesAsPaidHandler(token: string, args: MarkSalesAsPaidArgs): Promise<CallToolResult> {
  try {
    const data = await callCoolkiesApi(token, "/api/v1/sales/mark-paid", { method: "POST", body: args });
    return toolJson(data);
  } catch (e) {
    return toolError(e);
  }
}

export function registerSalesTools(server: McpServer): void {
  server.registerTool(
    "list_sales",
    {
      title: "Listar vendas",
      description:
        "Lista vendas do workspace ativo com os mesmos filtros da tela de vendas, e retorna um resumo (total pendente, total vencido). Use customerId + status: PENDING para saber quanto um cliente deve.",
      inputSchema: {
        status: z.enum(["PAID", "PENDING"]).optional(),
        q: z.string().optional().describe("Busca livre por nome do cliente, setor, observações ou produto"),
        customerId: z.string().optional(),
        from: z.string().optional().describe("Data inicial (ISO) da venda"),
        to: z.string().optional().describe("Data final (ISO) da venda"),
        forecastFrom: z.string().optional(),
        forecastTo: z.string().optional(),
        overdueOnly: z.boolean().optional().describe("Só vendas pendentes vencidas"),
      },
    },
    async (args, extra) => listSalesHandler(requireToken(extra), args),
  );

  server.registerTool(
    "create_sale",
    {
      title: "Registrar venda",
      description: "Registra uma venda com um ou mais itens já inclusos.",
      inputSchema: {
        customerId: z.string().optional(),
        customerName: z.string().optional(),
        soldAt: z.string().optional().describe("Data da venda (ISO), padrão agora"),
        notes: z.string().optional(),
        status: z.enum(["PAID", "PENDING"]).optional().describe("Padrão PAID"),
        forecastDate: z.string().optional().describe("Previsão de pagamento (ISO), só para PENDING"),
        discountType: z.enum(["PERCENTAGE", "FIXED"]).optional(),
        discountValue: z.number().optional(),
        items: z
          .array(
            z.object({
              itemId: z.string(),
              productName: z.string(),
              variantId: z.string().optional(),
              flavorName: z.string().optional(),
              quantity: z.number(),
              unitPriceCents: z.number(),
            }),
          )
          .min(1),
      },
    },
    async (args, extra) => createSaleHandler(requireToken(extra), args),
  );

  server.registerTool(
    "mark_sales_as_paid",
    {
      title: "Marcar vendas como pagas",
      description: "Marca uma venda, uma lista de vendas, ou todas as vendas pendentes de um cliente como pagas.",
      inputSchema: {
        saleId: z.string().optional(),
        saleIds: z.array(z.string()).optional(),
        customerId: z.string().optional(),
      },
    },
    async (args, extra) => markSalesAsPaidHandler(requireToken(extra), args),
  );
}
```

- [ ] **Step 4: Registrar em `src/tools/index.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkspaceTools } from "./workspaces";
import { registerItemTools } from "./items";
import { registerShoppingListTools } from "./shopping-list";
import { registerCustomerTools } from "./customers";
import { registerSalesTools } from "./sales";

export function registerTools(server: McpServer): void {
  registerWorkspaceTools(server);
  registerItemTools(server);
  registerShoppingListTools(server);
  registerCustomerTools(server);
  registerSalesTools(server);
}
```

- [ ] **Step 5: Rodar todos os testes do projeto e confirmar que passam**

Run: `pnpm vitest run`
Expected: PASS (todos — inclusive o teste end-to-end da Task B3, que agora exercita um servidor com as 11 tools registradas)

- [ ] **Step 6: Commit**

```bash
git add src/tools/sales.ts src/tools/index.ts src/tools/sales.test.ts
git commit -m "feat: tools list_sales, create_sale e mark_sales_as_paid"
```

---

## Depois deste plano

Com as 7 tasks concluídas, o `coolkies-mcp` expõe as 11 tools do escopo v1 sobre Streamable HTTP com OAuth. Falta, fora do escopo de código (ação manual do usuário, não delegável a um plano):

1. Configurar `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` e `BETTER_AUTH_URL` de produção no coolkies-system (já devem existir).
2. Fazer o deploy do `coolkies-mcp` na Vercel, configurando `COOLKIES_BASE_URL` (URL de produção do coolkies-system) e `MCP_PUBLIC_URL` (URL de produção do próprio `coolkies-mcp`) como env vars do projeto.
3. Registrar o connector no Claude Desktop / claude.ai apontando para `https://<coolkies-mcp>/mcp` e completar o login OAuth pelo navegador.
