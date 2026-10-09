# 🍪 Cookies App — Documento de Planejamento & TODO

> App **mobile-first** em **Next.js (App Router)** para gerenciar **pedidos (vendas) e receitas** de venda de cookies.
> Código em **inglês** (variáveis, rotas, pastas). Conteúdo da UI em **português**.

---

## 1. Stack técnica

| Camada | Escolha | Observação |
|---|---|---|
| Framework | **Next.js 15 (App Router, TypeScript)** | Server Components + Server Actions |
| Estilo | **Tailwind CSS** | Mobile-first, design tokens via CSS variables |
| Componentes | **shadcn/ui** (Radix + Tailwind) | Acessível, headless, customizável |
| Auth | **BetterAuth** | Social login **somente Google** |
| Banco | **PostgreSQL** | Local via `docker-compose` |
| ORM | **Prisma** | Schema declarativo + migrations |
| Datas | **date-fns** + **date-fns-tz** | Timezone `America/Sao_Paulo` |
| Dias úteis | **@date-fns/business** + tabela de feriados BR | Cálculo de "5º dia útil" |
| Moeda | **BRL** | Valores armazenados em **centavos (Int)** para evitar erro de ponto flutuante |
| Forms | **react-hook-form** + **zod** | Validação compartilhada client/server |
| Dados (client) | **TanStack Query** | Cache e revalidação dos filtros do dashboard |
| Gráficos | **Recharts** | Dashboard |
| Editor de blocos | **BlockNote** (estilo Notion) | Passo a passo das receitas; salva blocos em JSON |

### Convenções
- **Código**: inglês (`SalePaymentForecast`, `app/(app)/sales/`, `getStockBalance`).
- **UI**: português ("Nova venda", "Previsão de pagamento", "Lista de compras").
- **Mobile-first**: layout base 1 coluna, `bottom navigation` fixa; `md:` expande para sidebar/desktop.
- **Dinheiro**: sempre **Int em centavos** no banco; helpers `formatBRL()` / `parseBRL()` na borda da UI.

---

## 2. Padrão de Design (Design System)

### Princípios
1. **Mobile-first real**: todas as telas projetadas primeiro para ~375px. Ações primárias ao alcance do polegar.
2. **Bottom navigation** com 5 ícones: Dashboard · Vendas · Estoque · Mercados · Mais (Cadastros/Admin).
3. **Floating Action Button (FAB)** para a ação primária de cada tela (ex.: "+ Venda").
4. **Cards** em vez de tabelas densas no mobile; tabela só aparece em `md+`.
5. **Sheets/Drawers** (bottom sheet) para formulários no mobile em vez de modais centrais.
6. **Skeletons** em todo carregamento; **empty states** ilustrados e com CTA.

### Tokens (CSS variables — tema claro/escuro)
```
--background, --foreground
--primary        // marrom cookie  -> ex: 25 60% 35%
--secondary      // creme/caramelo
--accent         // chocolate
--muted, --border, --ring
--success, --warning, --destructive
--radius: 0.75rem
```
Paleta sugerida (inspirada em cookie/chocolate): primário `#8B5E3C`, accent `#5C3A21`, fundo creme `#FAF6F0`, sucesso verde, alerta âmbar.

### Tipografia
- Fonte: **Inter** (UI) via `next/font`. Números tabulares para valores monetários (`tabular-nums`).

### Componentes shadcn a instalar
`button, card, input, label, select, dialog, sheet, drawer, dropdown-menu, table, tabs, badge, calendar, popover, form, sonner (toast), skeleton, switch, separator, avatar, command, chart`

### Estrutura de componentes
```
components/
  ui/                # shadcn (gerado)
  layout/            # AppShell, BottomNav, TopBar, FabButton
  shared/            # MoneyInput, DatePicker, EmptyState, DataCard, ConfirmDialog
  charts/            # RevenueChart, ForecastChart, ProductMixChart
```

---

## 3. Arquitetura de pastas

```
src/
  app/
    (auth)/
      sign-in/page.tsx            # botão "Entrar com Google"
    (app)/                        # protegido por sessão
      layout.tsx                  # AppShell + BottomNav
      dashboard/page.tsx
      sales/
        page.tsx                  # lista
        new/page.tsx
        [id]/edit/page.tsx
      stock/
        page.tsx                  # saldo + produção
        shopping-list/page.tsx
      markets/
        page.tsx                  # mercados
        [id]/purchases/page.tsx   # compras de ingredientes
      admin/                      # somente role=ADMIN
        recipes/...
        ingredients/...
        catalog/...               # "Valores": produtos, sabores, preços
    api/
      auth/[...all]/route.ts      # BetterAuth handler
  lib/
    auth.ts                       # config BetterAuth
    auth-client.ts
    db.ts                         # PrismaClient singleton
    money.ts                      # formatBRL/parseBRL
    business-days.ts              # "dia 5" e "5º dia útil"
    holidays.ts                   # feriados nacionais BR
  server/
    actions/                      # Server Actions por módulo
    queries/                      # consultas read-only
  components/...
prisma/
  schema.prisma
  seed.ts
```

---

## 4. Modelo de dados (resumo)

> Detalhes completos no `prisma/schema.prisma`. Regra de ouro: **snapshots de preço** — toda venda guarda o valor unitário praticado **no momento da venda**, para não alterar métricas passadas.

- **User / Session / Account / Verification** — gerenciados pelo BetterAuth. `User.role` (`USER` | `ADMIN`).
- **AllowedEmail** ("pré-cadastro" / allowlist) — e-mails autorizados a acessar o app + role aplicado no 1º login.
- **Product** — produto (ex.: "Cookie"). Permite expandir além de cookies.
- **Flavor** — sabor (ex.: "Chocolate", "Red Velvet"), vinculado a `Product`.
- **PriceListItem** ("Valores") — preço atual de venda por `Product`+`Flavor`. Histórico em `PriceHistory`.
- **Sale** — uma venda. Campos: `soldAt`, `customerName?`, `status` (`PAID` | `PENDING`), `paidAt?`, `paymentForecastDate?`, total snapshot.
- **SaleItem** — item da venda com `productId`, `flavorId`, `quantity`, **`unitPriceSnapshot`** (centavos), `flavorNameSnapshot`.
- **Ingredient** — ingrediente (ex.: "Açúcar"), unidade base (`g`, `ml`, `un`).
- **Recipe** — receita; usa ingredientes; `steps` (JSON blocos TipTap); rende N cookies (`yieldQty`).
- **RecipeIngredient** — quantidade de cada ingrediente na receita (na unidade base).
- **Market** — mercado/loja onde se compra.
- **IngredientPurchase** — compra: `marketId`, `ingredientId`, `quantity`, `unit`, `pricePaid` (centavos), `purchasedAt`. Usado para calcular **custo do ingrediente pela última compra**.
- **ProductionBatch** — quantos cookies foram produzidos (entra no saldo de estoque).
- **StockMovement** — movimentações (`PRODUCTION` +, `SALE` −, `ADJUSTMENT` ±) → saldo atual = soma.
- **ShoppingListItem** — itens da lista de compras (manuais ou gerados por baixo estoque).

---

## 5. Módulos e TODO

### ☐ 0. Fundação
- [ ] `docker-compose.yml` Postgres local ✅ (entregue)
- [ ] Scaffold Next.js + Tailwind + shadcn ✅ (entregue)
- [ ] BetterAuth Google + Prisma schema ✅ (entregue)
- [ ] **Pré-cadastro (allowlist)**: hook bloqueia login fora da lista; revalidação por acesso; tela `/admin/access` ✅ (entregue)
- [ ] `lib/money.ts`, `lib/business-days.ts`, `lib/holidays.ts`
- [ ] AppShell + BottomNav + proteção de rota por sessão
- [ ] Middleware: bloquear `/admin` para `role != ADMIN`
- [ ] Seed inicial (produto Cookie, sabores, ingredientes exemplo)

### ☐ 1. Dashboard
- [ ] Cards de KPI: receita recebida, **receita prevista** (somatório de `paymentForecastDate` futuros), nº de vendas, ticket médio
- [ ] **Filtros avançados**: período (date range), status (pago/pendente), produto, sabor, cliente, mercado
- [ ] Gráfico de receita realizada x prevista por dia/semana/mês
- [ ] Gráfico de mix de produtos/sabores
- [ ] Alerta de estoque baixo e ingredientes a comprar
- [ ] Filtros persistidos na URL (`searchParams`) para compartilhar/voltar

### ☐ 2. Vendas (Sales)
- [ ] Listagem (cards no mobile, tabela no desktop) com busca e filtros
- [ ] Criar venda: cliente, data, itens (produto+sabor+qtd), valor unitário **puxa preço atual** mas é editável e **gravado como snapshot**
- [ ] **Status de pagamento**: pago agora **ou** pendente com **previsão de pagamento**
- [ ] Atalhos de previsão:
  - [ ] **"Dia 5"** → próximo dia 5 do mês (se hoje ≥ 5, vai pro mês seguinte)
  - [ ] **"5º dia útil"** → 5º dia útil do próximo mês (considerando feriados nacionais BR + fins de semana)
  - [ ] Data customizada
- [ ] Marcar como pago (preenche `paidAt`, remove da previsão)
- [ ] Editar / excluir venda (excluir reverte movimentação de estoque)
- [ ] Ao confirmar venda → gera `StockMovement` negativo por produto

### ☐ 3. Estoque (Stock)
- [ ] **Cadastro de produção**: "fiz X cookies do sabor Y hoje" → `ProductionBatch` + `StockMovement` (+)
- [ ] Saldo atual por produto/sabor (produção − vendas ± ajustes)
- [ ] Ajuste manual com motivo
- [ ] **Lista de compras** de ingredientes (manual + automática por estoque baixo)
- [ ] **Notificações** de compra: badge/toast quando ingrediente < mínimo
- [ ] Sugestão: cada `Ingredient` tem `minStock`; consumo estimado via receitas das vendas (fase 2)

### ☐ 4. Cadastros (Admin only)
#### 4a. Receitas (Recipes)
- [ ] CRUD de receitas usando ingredientes
- [ ] **Cadastro rápido de ingrediente** dentro da própria tela (dialog inline)
- [ ] **Editor de blocos estilo Notion** (BlockNote) para o passo a passo
- [ ] Mostrar **custo estimado da receita** com base na **última compra** de cada ingrediente
- [ ] Render: rendimento (`yieldQty`) e custo por cookie

#### 4b. Ingredientes (Ingredients)
- [ ] CRUD com unidade base e estoque mínimo
- [ ] Mostrar custo unitário atual (derivado da última `IngredientPurchase`)

#### 4c. Valores (Catalog: produtos, sabores, preços)
- [ ] CRUD de **Produtos** (permite expandir além de cookies)
- [ ] CRUD de **Sabores** por produto
- [ ] CRUD de **Preços** de venda atuais (`PriceListItem`) + histórico
- [ ] Regra: alterar preço **não** muda vendas passadas (snapshot garante isso)

### ☐ 5. Mercados e Preços (Markets)
- [ ] CRUD de **Mercados**
- [ ] Registrar **compra de ingrediente**: mercado, ingrediente, quantidade+unidade, valor pago, data
- [ ] Cálculo automático: **custo por unidade base** (ex.: paguei R$2,50 por 1kg de açúcar → R$0,0025/g → 200g = R$0,50)
- [ ] Consulta rápida: "quanto custa hoje 200g de açúcar?" (última compra)
- [ ] Comparar preço do mesmo ingrediente entre mercados
- [ ] Esses custos alimentam o **custo da receita** (módulo 4a)

---

## 6. Regras de negócio (resumo)

1. **Snapshot de preço de venda**: `SaleItem.unitPriceSnapshot` é copiado do `PriceListItem` no momento da venda. Mudanças futuras de preço **não** afetam métricas passadas.
2. **Previsão de recebimento**: vendas `PENDING` com `paymentForecastDate` entram na **receita prevista** do dashboard.
3. **"Dia 5"**: próxima ocorrência do dia 5; se hoje já passou do dia 5, agenda para o mês seguinte.
4. **"5º dia útil"**: 5º dia útil do mês de referência, pulando sábados, domingos e **feriados nacionais BR**.
5. **Custo de ingrediente**: sempre derivado da **última `IngredientPurchase`** convertida para unidade base.
6. **Estoque**: saldo = Σ produção − Σ vendas ± ajustes (event sourcing via `StockMovement`).
7. **Moeda**: armazenada em centavos (Int); formatação BRL só na UI.
8. **Admin**: módulo Cadastros restrito a `role = ADMIN`.

---

## 7. Roadmap sugerido (ordem de implementação)

1. Fundação (auth, db, shell, helpers) ← **base entregue**
2. Catalog/Valores (produtos, sabores, preços) — pré-requisito de Vendas
3. Vendas (com previsão de pagamento)
4. Dashboard (consome Vendas)
5. Ingredientes + Mercados/Compras (custos)
6. Receitas (consome ingredientes + custos)
7. Estoque (produção, saldo, lista de compras, notificações)
8. Polimento mobile, dark mode, PWA (opcional)

---

## 8. Variáveis de ambiente (`.env`)

```
DATABASE_URL=postgresql://cookies:cookies@localhost:5432/cookies
BETTER_AUTH_SECRET=<gerar com: openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=<google console>
GOOGLE_CLIENT_SECRET=<google console>
```
