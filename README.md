# 🍪 Cookies App

App **mobile-first** (Next.js + Tailwind + shadcn) para gerenciar vendas, receitas e estoque de cookies. Login social **somente Google** via **BetterAuth**, banco **PostgreSQL** com **Prisma**.

> Veja [`TODO.md`](./TODO.md) para o plano completo de design e módulos.

## Pré-requisitos
- Node 20+
- Docker (para o Postgres local)

## Setup

```bash
# 1. Instalar dependências
npm install

# 2. Subir o Postgres
npm run db:up        # docker compose up -d

# 3. Variáveis de ambiente
cp .env.example .env
# preencha GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET e gere o secret:
#   openssl rand -base64 32   -> BETTER_AUTH_SECRET

# 4. Criar o schema e popular dados de exemplo
npm run db:migrate   # cria as tabelas
npm run db:seed      # produto/sabores/ingredientes de exemplo

# 5. Rodar
npm run dev
```

App em http://localhost:3000.

## Google OAuth
No [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth client ID (Web):
- **Authorized redirect URI**: `http://localhost:3000/api/auth/callback/google`

## Timezone
Os cálculos de "Dia 5" e "5º dia útil" usam o horário do servidor. Rode com `TZ=America/Sao_Paulo` para garantir consistência:

```bash
TZ=America/Sao_Paulo npm run dev
```

## Tornar um usuário ADMIN
Após o primeiro login, promova seu usuário para acessar **Cadastros**:

```bash
npm run db:studio
# ou via SQL:
# UPDATE "user" SET role = 'ADMIN' WHERE email = 'voce@gmail.com';
```

## Scripts
| Script | Ação |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run db:up` / `db:down` | sobe/derruba o Postgres (Docker) |
| `npm run db:migrate` | cria/atualiza tabelas |
| `npm run db:seed` | dados de exemplo |
| `npm run db:studio` | Prisma Studio |

## Convenções
- Código (variáveis, rotas, pastas) em **inglês**; conteúdo da UI em **português**.
- Dinheiro sempre em **centavos (Int)**; formatação BRL apenas na UI (`lib/money.ts`).
- Toda venda guarda **snapshot** do preço — mudanças futuras não alteram métricas passadas.
