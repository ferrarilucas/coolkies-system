# Módulo de Mercado e Compras — genérico (matéria-prima + revenda)

Data: 2026-09-15
Status: aprovado para implementação

## Objetivo

Redesenhar o módulo de Mercado/Compras para deixar de ser burocrático e
específico de confeitaria. Uma compra passa a poder registrar tanto insumos
que viram matéria-prima de receita quanto itens comprados para revenda
direta, e o custo de ambos passa a ser descontado no cálculo de lucro do
dashboard. Escopo deliberadamente restrito ao módulo de Compras e ao mínimo
necessário do conceito de Insumo — o rebranding geral do vocabulário
("cookie", "receita", "recheio" em Produção/Catálogo/Dashboard) fica fora
deste spec.

## Decisões

1. **Insumo continua um cadastro só** (`Ingredient` no código, sem rename),
   generalizado com dois booleanos independentes: `isRawMaterial` (entra em
   receita/produção) e `forResale` (vira produto vendável). Um insumo pode
   ter os dois marcados ao mesmo tempo (ex.: açúcar comprado a granel, parte
   usada em receita, parte revendida embalada).
2. **`Market` vira `Supplier` (Fornecedor)**, deixa de ser obrigatório na
   compra e deixa de ter tela de cadastro própria como pré-requisito — é
   criado inline no formulário de compra. Mantém uma listagem simples
   (renomear/excluir) por conveniência, mas nunca é bloqueio para comprar.
3. **Compra vira cabeçalho + itens.** `IngredientPurchase` (um insumo por
   registro) é substituído por `Purchase` (fornecedor opcional, data) +
   `PurchaseItem` (N linhas: insumo, quantidade, unidade, preço pago),
   permitindo registrar uma ida ao mercado com vários itens em um só envio.
4. **"Preço lembrado" é derivado, não armazenado.** Ao escolher um insumo
   já comprado antes daquele fornecedor, quantidade/preço são pré-preenchidos
   com os valores da `PurchaseItem` mais recente daquele par
   fornecedor+insumo. Sem cache dedicado — é a mesma lógica de "custo =
   última compra" já usada no sistema, só filtrada por fornecedor.
5. **Insumo de revenda ganha um `Product` automaticamente.** Ao marcar
   `forResale=true`, cria-se um `Product` (sem `Flavor`, já que
   `SaleItem.flavorId` é opcional) para o insumo poder receber preço de
   venda e ser vendido normalmente. Ao desmarcar, o `Product` vira
   `active=false` (nunca é apagado — preserva histórico de vendas).
6. **Estoque de revenda reaproveita o ledger de `StockMovement`** já usado
   por produto acabado (hoje `PRODUCTION`/`SALE`/`ADJUSTMENT`). Novo valor
   `PURCHASE`: toda `PurchaseItem` de um insumo `forResale=true` gera um
   `StockMovement(PURCHASE, +quantidade)` no `Product` vinculado. A Despensa
   passa a exibir esse saldo (comprado − vendido) para insumos de revenda,
   ao lado do saldo de matéria-prima (comprado − consumido em produção) já
   existente. Um insumo com os dois flags soma os dois consumos.
7. **Lucro do dashboard passa a ter dois caminhos de COGS por item vendido:**
   se o `Product` da venda está vinculado a um insumo de revenda, o custo é
   `último preço de compra do insumo × quantidade vendida` (novo, direto);
   caso contrário, mantém o cálculo atual (custo médio de produção ×
   cookies vendidos). `grossProfit`/`marginPct` somam os dois caminhos.
8. **Consolidação de dívida técnica dentro do escopo:** a fórmula "custo =
   preço pago ÷ quantidade" está duplicada em 4 lugares
   (`ingredients.ts`, `recipes.ts`, `dashboard.ts`, `money.ts`). Como todos
   esses pontos precisam trocar a fonte de `IngredientPurchase` para
   `PurchaseItem` de qualquer forma, viram um único helper compartilhado
   (extensão de `unitCost` em `src/lib/money.ts`), aceitando filtro opcional
   por fornecedor.
9. **Metodologia de custeio não muda** (nem para matéria-prima nem para
   revenda): continua "última compra", sem média ponderada ou FIFO. Decisão
   explícita para não aumentar o escopo.

## Modelagem de dados

Migração escrita à mão (sem `prisma migrate dev`), aplicada via `docker
psql` nos bancos `cookies` e `cookies_test`, seguindo a prática já usada no
projeto.

### `Ingredient` — campos novos

| Campo             | Tipo               | Papel                                              |
|--------------------|--------------------|----------------------------------------------------|
| `isRawMaterial`    | Boolean @default(true)  | entra em receita/produção (comportamento atual) |
| `forResale`        | Boolean @default(false) | vira produto vendável                           |
| `resaleProductId`  | String? @unique    | FK para o `Product` criado automaticamente          |

Backfill: todo `Ingredient` existente recebe `isRawMaterial=true`,
`forResale=false` — comportamento atual 100% preservado até o usuário marcar
algo manualmente.

### `Market` → `Supplier`

Rename de tabela/model. Dados existentes preservados como fornecedores.
Relação com compra deixa de ser obrigatória.

### `IngredientPurchase` → `Purchase` + `PurchaseItem`

- `Purchase`: `id`, `workspaceId`, `supplierId` (opcional), `purchasedAt`,
  `notes?`.
- `PurchaseItem`: `id`, `purchaseId`, `ingredientId`, `quantity`, `unit`,
  `pricePaidCents`.

Backfill: cada `IngredientPurchase` existente vira um `Purchase` (
`supplierId` = antigo `marketId`, `purchasedAt` preservado) com exatamente
um `PurchaseItem` (os dados que já existiam na linha). Nenhum dado
histórico é perdido.

### `StockMovementType`

Adiciona o valor `PURCHASE` ao enum (`ALTER TYPE ... ADD VALUE`).

## Fluxo de UI

**Formulário de compra** (substitui `PurchaseDialog`):

1. Fornecedor — combobox que cria um novo pelo nome digitado (opcional).
2. Data da compra (default hoje).
3. Lista de itens, cada um com: insumo (combobox que também cria na hora,
   com toggle matéria-prima/revenda quando o insumo é novo), quantidade,
   unidade, preço pago. Botão "+ adicionar item" para múltiplas linhas.
4. Ao selecionar um insumo com histórico naquele fornecedor,
   quantidade/preço vêm pré-preenchidos com a compra mais recente do par
   (editável).
5. "Registrar compra" salva o cabeçalho + todas as linhas em uma
   transação.

**Aba Fornecedores**: lista simples para renomear/excluir, sem ser
pré-requisito para comprar.

**Despensa**: insumos de revenda mostram saldo (comprado − vendido) lido do
`StockMovement` do `Product` vinculado, ao lado do saldo de matéria-prima já
existente. Insumos com os dois flags mostram a soma dos dois consumos.

## Cálculo de custo/lucro

- `unitCost` em `src/lib/money.ts` vira o único ponto que lê `PurchaseItem`
  para achar o último preço pago por um insumo, com filtro opcional por
  `supplierId`. `ingredients.ts`, `recipes.ts` e `dashboard.ts` passam a
  chamar esse helper em vez de reimplementar a query.
- Em `dashboard.ts`, para cada `SaleItem`: se `product.id` bate com o
  `resaleProductId` de algum insumo, `cogs` do item = `unitCost(insumo) *
  quantity`; senão, mantém o cálculo atual via `ProductionBatch`/receita.
- `grossProfit = paidRevenue - cogs` e `marginPct` continuam iguais, com
  `cogs` agora somando os dois caminhos.

## Fora de escopo (explícito)

- Rebranding do vocabulário "cookie"/"receita"/"recheio" em
  Produção/Catálogo/Dashboard.
- Mudança de metodologia de custeio (média ponderada, FIFO, custo por
  lote).
- Tela de gestão de fornecedores além de renomear/excluir.
