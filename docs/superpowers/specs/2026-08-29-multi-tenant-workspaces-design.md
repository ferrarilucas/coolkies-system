# Multi-tenancy com workspaces

**Data:** 2026-08-29
**Status:** aprovado para planejamento
**Objetivo:** transformar o Cookies App de aplicação single-tenant em SaaS público, onde cada negócio opera num workspace isolado.

---

## 1. Contexto

O app hoje é single-tenant por construção. Não existe nenhuma noção de tenant no schema: `Product.name`, `Ingredient.name`, `Recipe.name`, `Market.name` e `Customer.email` são únicos globalmente, e as 16 actions/queries em `src/server/` acessam o banco sem filtro algum. O acesso é controlado por uma allowlist global (`AllowedEmail`) e por um `Role USER|ADMIN` no próprio usuário.

Existe base de produção em uso, com vendas, clientes e receitas reais que precisam sobreviver à mudança.

## 2. Escopo

**Dentro:**

- Isolamento de dados por workspace, garantido na camada de acesso
- Cadastro self-service e criação de workspace
- Convite de membros por e-mail, com papéis
- Migração dos dados de produção para um workspace inicial
- Infraestrutura de testes automatizados (não existe hoje)
- Assinatura recorrente via Asaas e liberação de acesso por plano

**Fora, explicitamente:**

- Limites de uso por plano (quantidade de vendas, membros, produtos)
- Emissão de nota fiscal
- Cupons, descontos e trials estendidos por cliente
- Subdomínios por tenant
- Super-admin de plataforma / impersonação
- Exportação de dados
- Login por e-mail e senha
- Providers OAuth além do Google
- Qualquer feature nova do domínio de cookies

## 3. Decisões de arquitetura

### 3.1 Isolamento: `workspaceId` + Prisma Client Extension

Coluna `workspaceId` em toda tabela de domínio, com o filtro **injetado automaticamente** por uma Prisma Client Extension. Nenhum código de domínio escreve o filtro à mão.

Alternativas descartadas:

- **Row Level Security no Postgres.** Garantia mais forte, mas o runtime usa pooler em transaction mode (`connection_limit=1`, porta 6543). `SET LOCAL` só sobrevive dentro da transação, o que obrigaria toda query a ser embrulhada em `$transaction` interativa — muitos round-trips e atrito com o pooler. Fica como possível camada extra no futuro: o schema desta decisão é exatamente o que RLS precisaria.
- **Schema ou banco por tenant.** Isolamento físico, mas cada tenant novo vira migration a rodar em N schemas, sem suporte do Prisma. Inviabiliza o modelo self-service.

A razão de fundo para a extension em vez de filtros manuais: esquecer o filtro num arquivo novo daqui a seis meses não pode vazar dados. O modo seguro precisa ser o padrão, não a disciplina.

### 3.2 Workspace ativo na sessão, URLs limpas

As rotas seguem `/sales`, `/dashboard` etc. O workspace ativo vive na sessão, com um seletor na navegação. Evita reescrever as ~25 páginas para um segmento dinâmico. Custo aceito: não é possível abrir dois workspaces em abas diferentes.

### 3.3 Auth: só Google

Mantém o provider atual. `emailAndPassword` permanece desabilitado. A configuração de providers é escrita como lista, para que adicionar Apple, Microsoft ou GitHub depois seja config e credenciais, não refatoração do fluxo.

Apple foi avaliado e adiado: exige Apple Developer Program (US$99/ano).

### 3.4 Workspaces via plugin `organization` do BetterAuth

Resolve organizações, membros, convites, papéis e `activeOrganizationId` na sessão — em vez de reimplementar tudo.

Os modelos serão mapeados para o vocabulário "Workspace" via a opção de schema do plugin. Se a versão instalada não permitir esse mapeamento, mantém-se `Organization` no banco e "Workspace" apenas na UI. É diferença cosmética e não justifica contorcer a integração.

---

## 4. Modelo de dados

### 4.1 Tabelas novas

| Tabela | Conteúdo |
|---|---|
| `Workspace` | `id`, `name`, `slug` (único), `createdAt`, `updatedAt` |
| `Member` | `userId`, `workspaceId`, `role`, `createdAt` — único por `[workspaceId, userId]` |
| `Invitation` | `email`, `workspaceId`, `role`, `tokenHash`, `status`, `expiresAt`, `inviterId`, `createdAt` |

O papel usa um enum novo, `MemberRole { OWNER, ADMIN, MEMBER }`, que substitui o enum `Role { USER, ADMIN }` global removido.

`Session` ganha `activeWorkspaceId`.

### 4.2 `workspaceId` nas 16 tabelas de domínio

`Product`, `Flavor`, `PriceListItem`, `PriceHistory`, `Customer`, `Sale`, `SaleItem`, `Ingredient`, `Market`, `IngredientPurchase`, `Recipe`, `RecipeIngredient`, `ProductionBatch`, `ProductionFilling`, `StockMovement`, `ShoppingListItem`.

Inclui as tabelas filhas, ainda que a coluna seja redundante nelas. A razão é a extension: o código atual consulta filhos diretamente, sem passar pelo pai — `db.stockMovement.deleteMany({ where: { saleId: id } })` e `db.saleItem.deleteMany({ where: { saleId: id } })` em `src/server/actions/sales.ts`. Se algumas tabelas tivessem a coluna e outras não, a extension precisaria de um mapa de "como chegar ao tenant a partir daqui", com uma exceção por modelo — exatamente onde vazamentos se escondem. Uniformidade compra uma extension que trata todo modelo igual.

A redundância não desincroniza porque nada escreve `workspaceId` à mão: a extension injeta em todo create, inclusive aninhado.

Todas as relações com `Workspace` usam `onDelete: Cascade`. `User` fica fora disso: um usuário participa de vários workspaces e sobrevive à exclusão de qualquer um.

### 4.3 Uniques

| Tabela | Antes | Depois |
|---|---|---|
| `Product` | `@@unique([name])` | `@@unique([workspaceId, name])` |
| `Ingredient` | `@@unique([name])` | `@@unique([workspaceId, name])` |
| `Market` | `@@unique([name])` | `@@unique([workspaceId, name])` |
| `Recipe` | `@@unique([name])` | `@@unique([workspaceId, name])` |
| `Customer` | `email String? @unique` | `@@unique([workspaceId, email])` |

O caso de `Customer.email` é o mais grave: hoje dois workspaces não conseguiriam cadastrar o mesmo cliente, e o erro de constraint revelaria que aquele e-mail já existe em outro tenant. É vazamento de informação, não apenas inconveniência.

Uniques já relativas a um pai permanecem inalteradas, porque o pai já está preso a um workspace: `Flavor[productId, name]`, `PriceListItem[productId, flavorId]`, `RecipeIngredient[recipeId, ingredientId]`.

### 4.4 Índices

`workspaceId` passa a ser a primeira coluna, já que todo filtro começa por workspace:

- `Sale[workspaceId, soldAt]`
- `Sale[workspaceId, status, paymentForecastDate]`
- `StockMovement[workspaceId, productId, flavorId]`
- `IngredientPurchase[workspaceId, ingredientId, purchasedAt]`

### 4.5 Removidos

- Tabela `AllowedEmail` e o `databaseHook` de `src/lib/auth.ts` que bloqueia criação de usuário fora da allowlist
- `User.role` e o enum `Role` global — papel passa a viver em `Member`

Ambos são removidos na **migration 4**, na fase 4, junto com o código que depende deles — nunca antes. Ver seção 9.

---

## 5. Camada de acesso

### 5.1 Porta de entrada

`getWorkspaceContext()` lê a sessão, resolve `activeWorkspaceId` e o papel do membro, e lança se não houver workspace ativo.

`getWorkspaceDb()` devolve um Prisma Client estendido, preso a esse workspace.

Todo arquivo em `src/server/` passa a obter o client dentro de cada função, em vez de importar `db` no topo do módulo como hoje.

### 5.2 A extension

Intercepta via `$allOperations`:

- injeta `workspaceId` no `where` de toda leitura, atualização e remoção
- injeta `workspaceId` no `data` de toda escrita
- modelos de auth passam intactos, por allowlist: `user`, `session`, `account`, `verification`, `workspace`, `member`, `invitation`

Três casos de borda exigem tratamento explícito:

**`findUnique` reescrito para `findFirst`.** O Prisma não aceita campo não-único no `where` de `findUnique`. Sem essa reescrita, chamadas como `findUnique({ where: { id } })` — presentes em `markAsPaid` e em várias queries — leriam linhas de qualquer tenant.

**Walker recursivo para nested writes.** `db.sale.create({ data: { items: { create: [...] } } })` é o padrão de `createSale` e `updateSale`. Uma extension que injeta apenas no nível de topo deixaria os `SaleItem` filhos sem workspace. A correção percorre recursivamente o `data`, usando o DMMF do Prisma para resolver o modelo de destino de cada campo de relação, e injeta `workspaceId` em cada `create` e `connectOrCreate` aninhado.

**`$queryRaw` não é interceptável.** Proibido dentro de `src/server/`. Não há nenhum uso hoje.

### 5.3 Enforcement

Regra ESLint `no-restricted-imports` barrando `@/lib/db` em `src/server/**`. O client cru continua existindo para o BetterAuth e para as migrations, mas importá-lo na camada de domínio quebra o build.

Sem essa regra a extension é convenção; com ela, é garantia.

---

## 6. Auth, sessão e workspace ativo

**Providers:** Google apenas, declarado como lista de providers.

**Allowlist removida:** o hook que hoje recusa usuários fora de `AllowedEmail` sai junto com a tabela. A página `/not-authorized` é reaproveitada para "convite inválido ou expirado".

**Resolução do workspace ativo** acontece em ponto único, `src/app/(app)/layout.tsx`:

1. usuário sem nenhum workspace → redireciona para onboarding
2. com workspaces, nenhum ativo → ativa o primeiro
3. com ativo → injeta o contexto e renderiza

`src/middleware.ts` permanece como está, checando apenas presença do cookie. A validação real continua no servidor.

**Invalidação de cache.** Como `/sales` é a mesma URL em todos os workspaces, trocar de workspace sem invalidar cache pode exibir dados do anterior. Duas proteções: as páginas já são dinâmicas, porque todas leem `headers()` para obter a sessão, o que descarta o Full Route Cache; e a action de troca executa `revalidatePath("/", "layout")` seguido de `router.refresh()` no cliente, limpando o Router Cache.

**Regra decorrente, a ser respeitada por qualquer código futuro:** se `unstable_cache` ou `fetch` cacheado for introduzido, a tag de cache precisa incluir o `workspaceId`. Esta é a armadilha que a escolha de URLs limpas deixa armada.

**Seletor de workspace** em `src/components/layout/side-nav.tsx` no desktop e dentro de `/more` no mobile, seguindo o padrão de navegação existente.

---

## 7. Papéis e permissões

Papel vive em `Member`, não em `User`: a mesma pessoa pode ser dona do próprio workspace e operadora no de outra.

| Papel | Pode |
|---|---|
| `OWNER` | tudo, mais transferir posse e excluir o workspace. Um por workspace. |
| `ADMIN` | tudo de MEMBER, mais catálogo, preços, receitas, ingredientes, mercados e gestão de membros |
| `MEMBER` | operação diária: vendas, pagamentos, produção, compras de ingrediente, lista de compras, dashboard |

**A fronteira é escrita, não leitura.** O MEMBER lê catálogo, sabores, preços, receitas e ingredientes — sem isso não registraria uma venda, não lançaria produção e não registraria compra. O que não pode é alterar.

Matriz por arquivo de action:

| Arquivo | Papel mínimo |
|---|---|
| `catalog.ts` (produtos, sabores, preços) | ADMIN |
| `ingredients.ts` | ADMIN |
| `recipes.ts` | ADMIN |
| `markets.ts` — cadastro de mercado | ADMIN |
| `markets.ts` — registro de compra | MEMBER |
| `sales.ts` | MEMBER |
| `production.ts` | MEMBER |
| `customers.ts` | MEMBER |
| lista de compras | MEMBER |
| membros e convites | ADMIN |
| excluir workspace, transferir posse | OWNER |

A checagem é feita no servidor, dentro das actions. Esconder itens de navegação é complemento de UX, não o controle.

`isAdmin()` em `src/lib/session-user.ts` é reescrito sobre o contexto de workspace, deixando de consultar o papel global do usuário.

Não haverá super-admin de plataforma. Acesso de suporte a um workspace, se necessário, é feito por SQL.

---

## 8. Onboarding e convites

### 8.1 Onboarding

Primeiro login sem workspace leva a uma tela única: nome do negócio, slug derivado automaticamente. O criador vira `OWNER` e entra no dashboard.

Sem seed de dados de exemplo. Os empty states com CTA já existem em `src/components/shared/empty-state.tsx`.

### 8.2 Convites

ADMIN ou OWNER informa e-mail e papel. O sistema gera token aleatório longo e armazena apenas o **hash** — o token em claro existe só no link do e-mail, de modo que vazamento do banco não vira acesso. Validade de 7 dias.

Token de 32 bytes aleatórios (`crypto.randomBytes`), armazenado como SHA-256. O destinatário abre o link, autentica e vira membro. **O aceite é pelo token, nunca por comparação de e-mails**: permite ser convidado num endereço e entrar com outro. Se quem clica já é membro, o link apenas ativa aquele workspace.

Estados: `PENDING`, `ACCEPTED`, `CANCELED`, `EXPIRED`. Operações: reenviar e cancelar.

### 8.3 Tela de membros

Substitui `/admin/access`, que hoje administra a allowlist. Lista membros e convites pendentes, permite trocar papel e remover. O OWNER não pode ser removido nem rebaixado sem antes transferir a posse.

### 8.4 E-mail

Resend com domínio verificado, um único template (convite). Em desenvolvimento, o envio imprime o link no console — testar convite localmente não deve exigir caixa de entrada.

---

## 9. Migração dos dados de produção

Adicionar coluna `NOT NULL` em 16 tabelas com dados existentes falha, e tornar `Product.name` único por workspace antes de existir workspace também falha. Por isso, três migrations separadas.

### Migration 1 — aditiva

Cria `Workspace`, `Member`, `Invitation`; adiciona `activeWorkspaceId` em `Session` e `workspaceId` **nullable** nas 16 tabelas. Nada quebra; o app continua rodando.

### Migration 2 — backfill

Script que:

1. cria o workspace **Douce Vie**, slug `douce-vie`
2. cria `Member` com papel `OWNER` para a conta cujo e-mail é passado ao script como parâmetro obrigatório — o script falha se o e-mail não existir na tabela `user`, em vez de adivinhar
3. cria `Member` com papel `MEMBER` para todos os demais usuários já existentes
4. faz `UPDATE` nas 16 tabelas setando o `workspaceId` desse workspace

Toda a base existente passa a ser o primeiro tenant.

### Verificação — bloqueante

Script executável no repositório (não instrução em README) que conta linhas com `workspaceId IS NULL` em cada uma das 16 tabelas. Se qualquer contagem for diferente de zero, a migration 3 não roda.

### Migration 3 — aperto

Somente após verificação limpa:

- `workspaceId` vira `NOT NULL`
- foreign keys com `onDelete: Cascade`
- uniques compostas substituem as globais
- índices recriados com `workspaceId` na frente

### Migration 4 — limpeza da allowlist

Roda na **fase 4**, não aqui: remove `AllowedEmail`, `User.role` e o enum `Role`.

A separação é necessária. Enquanto o `databaseHook` de `src/lib/auth.ts` ainda consultar `AllowedEmail`, derrubar a tabela quebra o login no primeiro acesso de qualquer usuário. Schema e código que dependem um do outro precisam sair juntos.

### Operação

Migrations 1 e 2 são reversíveis sem perda. A 3 é o ponto sem volta: **dump completo do banco antes**. Todas rodam pela `DIRECT_URL` (porta 5432), nunca pelo pooler, conforme o schema já documenta.

---

## 10. Billing e liberação por plano

### 10.1 Gateway: Asaas

Escolhido por reunir Pix Automático, cartão recorrente e boleto num só lugar, com sandbox independente (API key própria, sem mover valores reais) e documentação em português.

**Pix Automático** é o método principal: regulado pela Resolução BCB nº 422/2025 e em operação desde janeiro de 2026, com ampla cobertura bancária e MDR de 0,4%–1,2%, contra 3%–4,5% de cartão recorrente. Exige conta **PJ**. Cartão fica como alternativa para quem não autorizar o débito.

### 10.2 A assinatura pertence à pessoa, não ao workspace

**Correção de desenho, decidida em 2026-08-30.** A versão original desta secão punha `plan` e `subscriptionStatus` em `Workspace`, assumindo uma assinatura por workspace. Isso nao suporta a tabela de precos definida depois, que cobra por **quantidade de workspaces**:

| Plano | Workspaces | Mensal | Anual |
|---|---|---|---|
| `solo` | 1 | R$ 29,90 | R$ 19,90/mes |
| `team` | ate 4 | R$ 99,90 | R$ 89,90/mes |
| `unlimited` | sem teto | sob consulta | sob consulta |

Como "ate 4 workspaces por R$ 99,90" precisa de algo que agrupe os workspaces, a assinatura passa a viver no **usuario**, e o workspace herda o estado do seu `OWNER`. Para saber se o Douce Vie esta ativo, consulta-se a assinatura de quem e OWNER dele.

Model `Subscription`, um por usuario:

| Campo | Conteudo |
|---|---|
| `userId` | dono da assinatura; unico |
| `plan` | `solo`, `team` ou `unlimited` |
| `status` | `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELED` |
| `source` | `ASAAS` ou `MANUAL` |
| `asaasCustomerId` | opcional — ausente em assinatura manual |
| `asaasSubscriptionId` | opcional — ausente em assinatura manual |
| `trialEndsAt` | fim do teste, 14 dias a partir do primeiro workspace |
| `graceUntil` | fim da tolerancia apos falha de pagamento |
| `currentPeriodEnd` | fim do ciclo pago |
| `notes` | por que e manual, com quem foi negociado |

Os limites por plano (`solo` = 1, `team` = 4, `unlimited` = sem teto) vivem como constante no codigo, nao no banco: atribuir um plano manualmente passa a ser um `UPDATE` de duas colunas, sem inventar linha de configuracao.

**`source` nao e opcional no desenho.** O plano `unlimited` e vendido por conversa, nao por checkout, entao existe assinatura sem contraparte no Asaas. Sem esse campo, a rotina de reconciliacao da secao 10.3 consultaria a API do Asaas por um id inexistente e marcaria como invalida justamente a assinatura do cliente negociado a mao. A reconciliacao ignora `source = MANUAL`.

**Contagem do limite:** conta-se em quantos workspaces a pessoa e `OWNER`. Participar do workspace de outra pessoa como ADMIN ou MEMBER nao consome cota — voce paga pelos negocios que sao seus.

**Quando alguem excede o limite** (por exemplo, ao baixar de plano), valem os **mais antigos**: ordenam-se os workspaces onde a pessoa e OWNER por data de criacao, os primeiros N conforme o plano ficam ativos, e os excedentes entram em somente-leitura com alerta de upgrade. A regra e deterministica — a pessoa sabe de antemao qual negocio continua funcionando — e nenhum dado deixa de ser visivel, conforme a secao 10.4.

**O trial e da conta, nao do workspace.** No desenho antigo, cada workspace novo daria 14 dias — teste infinito de graca.

**Durante o trial o limite e sempre 1 workspace**, qualquer que seja o plano registrado. Quem quiser um segundo workspace precisa assinar. O limite efetivo e portanto `status === TRIALING ? 1 : planLimit(plan)`.

**O tempo restante do trial fica visivel.** Enquanto a assinatura esta em `TRIALING`, uma faixa fina no topo mostra quantos dias faltam. Ela desaparece assim que a assinatura vira `ACTIVE` — nao e um aviso de erro, e uma contagem, e some quando deixa de importar.

### 10.3 Estado derivado, não copiado

**O Asaas não emite webhook de assinatura — apenas de cobrança.** Toda cobrança pertencente a uma assinatura carrega o campo `subscription` no JSON do webhook, e é por ele que se faz o vínculo.

Consequência: `subscriptionStatus` é uma máquina de estados nossa, alimentada por eventos de cobrança:

| Evento recebido | Novo estado |
|---|---|
| `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` | `ACTIVE`, `graceUntil` limpo |
| `PAYMENT_OVERDUE` | `PAST_DUE`, `graceUntil` = agora + 7 dias |
| cancelamento da assinatura | `CANCELED` |
| `trialEndsAt` vencido sem pagamento | `PAST_DUE` |

O endpoint de webhook valida o token configurado no Asaas antes de processar, e é **idempotente**: o id do evento é registrado, e reentrega do mesmo evento não reaplica efeito. Gateways reenviam.

### 10.4 Liberação: somente-leitura, nunca bloqueio total

`assertCanWrite()` vive ao lado de `getWorkspaceContext()` na camada de acesso e recusa **escritas** quando a assinatura do `OWNER` do workspace ativo não está em `TRIALING` ou `ACTIVE` e a tolerância expirou.

Leitura nunca é bloqueada. O dono continua vendo vendas, clientes e histórico; apenas não registra nada novo. Bloquear acesso a dados que o cliente criou gera contestação e ressentimento — travar escrita converte. A UI mostra um banner persistente com o link de regularização.

`OWNER` mantém acesso de escrita à tela de assinatura mesmo em `PAST_DUE`, caso contrário o cliente não conseguiria pagar.

### 10.5 Telas

O Asaas não oferece portal do cliente hospedado, ao contrário da Stripe. São nossas:

- assinatura: plano atual, status, próxima cobrança, método
- contratação: autorização de Pix Automático ou cartão
- histórico de cobranças
- banner de inadimplência

Este é o custo real da escolha do gateway, e foi aceito conscientemente em troca de Pix Automático.

## 11. Testes

O projeto não possui testes hoje. Entram Vitest e um Postgres de teste, e a camada de isolamento não é exceção à cobertura.

**Caso central:** dois workspaces com dados semelhantes, e toda operação de cada modelo provando que um não enxerga o outro — leitura, escrita, atualização, remoção, contagem e agregação.

**Casos obrigatórios de billing:**

- workspace em `PAST_DUE` com tolerância vencida recusa escrita e permite leitura
- webhook duplicado não reaplica efeito
- webhook com token inválido é recusado
- `OWNER` em `PAST_DUE` ainda acessa a tela de assinatura

**Casos obrigatórios adicionais:**

- `findUnique` por id de outro tenant não retorna a linha
- nested write de `createSale` grava `workspaceId` correto em todos os `SaleItem` e `StockMovement` filhos
- `deleteMany` com `where` de campo não-tenant não atinge linhas de outro workspace
- `upsert` respeita o escopo tanto no create quanto no update
- unique composta permite o mesmo nome de produto em workspaces distintos
- action que exige ADMIN recusa chamada de MEMBER

---

## 12. Fases de implementação

Cada fase deixa o app funcionando. Nenhuma exige que a próxima esteja pronta para subir.

| Fase | Conteúdo | Estado ao fim |
|---|---|---|
| 1 | Migration aditiva, Vitest + Postgres de teste, extension com testes de isolamento | app roda igual, ainda single-tenant |
| 2 | Backfill Douce Vie, script de verificação, migration 3 (aperto) | multi-tenant no banco, um tenant |
| 3 | 16 arquivos de `src/server/` migram para `getWorkspaceDb()`; regra ESLint entra | camada de domínio escopada |
| 4 | Plugin `organization`, migration 4 + remoção do hook de allowlist, seletor de workspace, papéis por membro, onboarding | workspaces utilizáveis |
| 5 | Resend, template, aceite por token, tela de membros | convites funcionando |
| 6 | Campos de billing, máquina de estados, webhook Asaas, `assertCanWrite()`, telas de assinatura | cobrança em produção |

A extension é escrita e testada na fase 1, antes de qualquer código de domínio depender dela.

## 13. Riscos

**Walker de nested writes.** Peça onde um erro produz dado órfão ou vazamento silencioso, apoiada em DMMF, que é API pouco documentada. Mitigação: primeira coisa escrita, teste antes do uso, e `createSale` — o nested write mais complexo do app — como caso de teste explícito.

**Janela da migration 3.** Único ponto irreversível. Mitigação: dump prévio, script de verificação bloqueante, execução por `DIRECT_URL`.

**Webhook de cobrança como fonte de verdade.** Derivar estado de assinatura a partir de eventos de cobrança é mais frágil que ler um estado pronto: evento perdido ou fora de ordem desalinha o status. Mitigação: idempotência por id de evento, e uma rotina diária que reconcilia o status consultando a API do Asaas em vez de confiar apenas no que chegou.

**Volume do escopo.** São 16 tabelas, 16 arquivos de servidor, ~25 páginas e o modelo de acesso trocado. Mitigação: fases entregáveis. Parar após a fase 3 já deixa um app multi-tenant sólido com um tenant, base melhor que a atual.
