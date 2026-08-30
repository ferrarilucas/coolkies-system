# SDD ledger — plan: docs/superpowers/plans/2026-08-29-fundacao-multi-tenant.md

Spec: docs/superpowers/specs/2026-08-29-multi-tenant-workspaces-design.md
Worktree: /Users/ferrari/code/coolkies-system/.claude/worktrees/multi-tenant
Branch: feat/multi-tenant-workspaces
Base: 9126de3

## Setup do ambiente

- `.env` nao existia no repo original; criado no worktree apontando para o Postgres do docker-compose
- Container `cookies_db` estava parado ha 8 semanas; reiniciado (reusa o volume original, com dados de desenvolvimento)
- 2 migrations pendentes aplicadas via `prisma migrate deploy`
- `npm install` concluido; `npx tsc --noEmit` limpo
- Nao ha suite de testes no baseline — a Task 1 a cria

## Pre-flight scan

### Pares de tasks que compartilham arquivo ou interface

| Par | Produz / consome | Achado |
|---|---|---|
| T1 → T2 | `src/test/db.ts`: T1 cria `testDb`/`resetDb`, T2 acrescenta `createWorkspace` | OK — `resetDb` lista tabelas que so existem apos T2, mas o unico teste de T1 nao a chama |
| T2 → T3 | `createWorkspace`, coluna `workspaceId` nullable | OK |
| T3 → T4 | `extension.ts` e `extension.test.ts` | OK — contagens de teste 7 e 9 conferem |
| T3,T4 → T5 | `extension.ts` bloco `CREATE_OPS` | OK |
| T5 → T6 | `scopedDb` | OK |
| T2 → T7 | models `Workspace`/`Member` | OK |
| **T7 → T8** | lista `DOMAIN_TABLES` (16 nomes) | **CONFLITO — duplicacao verbatim em dois arquivos** |
| **T3,T5** | `UNSCOPED_MODELS` (7 nomes) | **CONFLITO — duplicacao verbatim em `extension.ts` e `nested-writes.ts`** |
| T9 → T3,T4,T5 | `extension.test.ts` | ver R3 |
| T6 → T10,T11,T12 | `getWorkspaceDb`, `requireRole`, `getWorkspaceContext` | OK — assinaturas conferem |
| T10,T11,T12 → T13 | ausencia de import de `@/lib/db` em `src/server/` | OK — `context.ts` importa o client cru mas fica sob o `ignores` da regra |

### Auto-consistencia de cada task

| Task | Achado |
|---|---|
| T1 | OK |
| **T2** | **CONFLITO — o teste "permite produto sem workspace" passa a falhar na T9, quando a coluna vira NOT NULL** |
| T3 | OK |
| T4 | OK |
| T5 | OK — `resetDb` limpa `user`, entao o id fixo `u-nested` nao colide entre execucoes |
| T6 | OK |
| T7 | OK — `$executeRawUnsafe` aceita parametro posicional |
| T8 | OK |
| T9 | ver R3 |
| T10 | OK |
| T11 | OK |
| T12 | OK |
| **T13** | **CONFLITO — a task diz "Modify: eslint.config.mjs", mas esse arquivo nao existe no repo** |

### Rulings

Ruling R1: a lista `DOMAIN_TABLES` sai para `scripts/domain-tables.ts`, criado na T7 e importado pela T8 — o plano manda duplicar 16 nomes em dois arquivos, e o rubric de review trata duplicacao verbatim como defeito. Custo se errado: um import a mais entre dois scripts operacionais; trivial de reverter.

Ruling R2: `UNSCOPED_MODELS` passa a ser exportado por `src/server/tenant/nested-writes.ts` e importado por `extension.ts`, em vez de declarado nos dois. A T5 cria `nested-writes.ts`, entao a T3 declara a constante localmente e a T5 a move ao criar o modulo. Custo se errado: se as duas listas precisarem divergir no futuro, sera preciso separa-las de novo.

Ruling R3: a T9 remove o teste "permite produto sem workspace enquanto a coluna for nullable" de `src/server/tenant/schema.test.ts` — ele afirma exatamente o que a migration de aperto elimina, e mante-lo quebraria a suite. Custo se errado: perde-se a cobertura de um estado intermediario que deixa de existir apos a T9; nenhum.

Ruling R4: a T13 **cria** `eslint.config.mjs` em vez de modifica-lo, com a config flat do `eslint-config-next` mais a regra `no-restricted-imports`. O projeto tem `eslint` e `eslint-config-next` instalados e o script `lint`, mas nenhum arquivo de config. Custo se errado: se houver config de lint em outro formato que eu nao encontrei, a nova config a substitui e o comportamento de lint do projeto muda.

## Progresso

Task 1: implementada (commit 4d83d5f), status DONE_WITH_CONCERNS, 1 teste passando, tsc limpo. Review despachado.

Ruling R5: aceito `vitest.config.mts` no lugar de `vitest.config.ts` pedido pelo plano. `vite-tsconfig-paths@5.1.4` e ESM-only e o projeto e CJS (sem `"type": "module"` no package.json); a extensao `.mts` e a correcao padrao e evita mexer no tipo de modulo do projeto, o que quebraria os configs CJS do Next/Tailwind/PostCSS. Nenhuma outra task toca esse arquivo. Custo se errado: nenhum funcional — se um dia o projeto virar ESM, o arquivo pode voltar a `.ts`.

Ruling R6: o script `test:db:setup` troca `docker compose exec -T db` por `docker exec cookies_db`. O plano ditou a forma com `docker compose`, mas ela falha quando o container foi subido a partir de outro diretorio — que e exatamente o caso aqui, porque o worktree reusa o container do repo original em vez de criar um segundo Postgres. O nome `cookies_db` e fixo no `docker-compose.yml` (`container_name`), entao a forma direta e igualmente deterministica e mais robusta. Isso e um defeito do plano, nao do implementador. Custo se errado: o script deixa de funcionar se alguem renomear o container no docker-compose.yml; o erro seria imediato e obvio.

Task 2 depende de R6 — ela roda `npm run test:db:setup` no Step 6.

Task 1: review 1 — spec OK, qualidade aprovada. 1 Important: `test:db:setup` nao incorporou R6. 2 minors deferidos: (a) `.env.example` repete `DATABASE_URL`/`DIRECT_URL` num segundo bloco, conforme o plano pediu — cosmetico; (b) `tsconfig.tsbuildinfo` e `yarn.lock` aparecem sujos no working tree, ruido pre-existente do ambiente, fora do commit.

Task 1: fix round 1/5 (1 addressed, 0 open; commits 4d83d5f..17f59c8) — re-review confirmou as duas trocas, script intacto no resto, sem quebra nova.
Task 1: complete (commits 9126de3..17f59c8, review clean)

Task 2: implementada (commit 4ade1d3), status DONE, 3/3 testes passando, build e tsc limpos. Review despachado.
Task 2: a investigar no review — a migration trouxe um `DROP INDEX "stock_movement_productionBatchId_key"` nao pedido. O implementador explica como drift pre-existente da migration 20260622, que tentou remover a constraint com `DROP CONSTRAINT IF EXISTS` mas nunca surtiu efeito porque o indice foi criado como `CREATE UNIQUE INDEX` direto. Se procede, o unique impedia mais de um StockMovement por ProductionBatch, o que contradiz a relacao `movements StockMovement[]` ja declarada no schema — seria correcao de bug latente, nao mudanca de comportamento. Pedi ao revisor que decida entre os dois.
Task 2: minor deferido — `yarn.lock` continua sujo no working tree apos npm install; ruido pre-existente, fora de todo commit. O revisor sugere considerar remover `yarn.lock` e `pnpm-lock.yaml` do repo, ja que o gerenciador oficial e npm — fica para o review final.
Task 2: review 1 — spec OK (16 models corretos, sem relacao/FK prematura), qualidade aprovada, 0 Critical/Important.
Task 2: DROP INDEX esclarecido — o revisor rastreou a cadeia: `20260609235700_init` criou `stock_movement_productionBatchId_key` via `CREATE UNIQUE INDEX`, e `20260622` tentou remover com `DROP CONSTRAINT IF EXISTS`, que nao atinge indice criado assim — no-op silencioso. O schema ja declara `movements StockMovement[]` e nenhum codigo de app depende da unicidade. E correcao de bug latente, nao mudanca de comportamento. Aceito.
Task 2: complete (commits 17f59c8..4ade1d3, review clean)

Task 3: implementada (commit baf1ab3), status DONE_WITH_CONCERNS, 10/10 testes, tsc limpo. Review despachado.

Ruling R7: `AllowedEmail` entra em `UNSCOPED_MODELS` na extension. O implementador da Task 3 notou a ausencia; confirmei que e defeito real. `AllowedEmail` e model de plataforma (decide quem pode existir no app), nao de dominio — nao recebeu `workspaceId` na Task 2 e nao deve receber. Sem ela na lista, qualquer chamada via client escopado injetaria `where: { workspaceId }` numa tabela sem essa coluna e falharia em runtime. Custo se errado: nenhum — a lista so determina o que a extension ignora, e `AllowedEmail` nunca deve ser escopado.

Ruling R8: `src/server/actions/allowlist.ts` entra no `ignores` da regra ESLint da Task 13, ao lado de `src/server/tenant/**`. Verifiquei: 16 arquivos em `src/server/` importam `@/lib/db`, e as Tasks 10-12 migram 15 deles — `allowlist.ts` nao aparece em nenhuma. A regra da Task 13 quebraria o lint nesse arquivo. Migra-lo para o client escopado seria errado: a allowlist e global por natureza e sera removida pela migration 4 do proximo plano. Custo se errado: um arquivo continua usando o client cru legitimamente ate ser deletado no proximo plano; se alguem acrescentar acesso a dados de dominio nesse arquivo, a regra nao o pegaria.

Task 3: review 1 — spec OK, qualidade aprovada. 1 Important (AllowedEmail fora de UNSCOPED_MODELS). O revisor varreu o schema e confirmou que nao ha outro model na mesma situacao: sem `workspaceId` existem exatamente User, Session, Account, Verification, AllowedEmail, Workspace, Member, Invitation.
Task 3: o revisor validou que os testes de isolamento exercitam o risco de verdade — nenhum passa por ausencia de dados do outro workspace. O ajuste de nomes no teste de `deleteMany` veio acompanhado de um `expect(before).toHaveLength(2)`, o que fortalece a pre-condicao em vez de enfraquece-la.
Task 3: minors deferidos — (a) casts `as never` nos branches de injecao reduzem protecao de tipos justamente nos pontos sensiveis; aceitavel dado o limite de tipagem do `$allOperations`, mas pede atencao nas Tasks 4 e 5, que mexem nesses mesmos branches; (b) `scopedDb` cria um `$extends` novo a cada chamada, sem memoizacao — observar se virar hot path.

RISCO DE SEQUENCIAMENTO (registrado pelo revisor): ate as Tasks 4 e 5 estarem prontas, `scopedDb` nao escopa `findUnique`/`findUniqueOrThrow` nem escritas aninhadas. Existem 7 call sites reais de `findUnique` em `src/server/`. Nenhum arquivo de dominio pode passar a usar `getWorkspaceDb()` antes da Task 5 — a Fase 3 (Tasks 10-12) so comeca depois, o que o plano ja garante.

Task 3: fix round 1/5 — despachado ao implementador original (aplicar R7: AllowedEmail em UNSCOPED_MODELS).
Nota para a Task 5: ao mover `UNSCOPED_MODELS` para `nested-writes.ts` (ruling R2), a lista ja deve conter `AllowedEmail`.
Task 3: fix round 1/5 (1 addressed, 0 open; commits baf1ab3..7a4d198) — string em PascalCase correta, diff de 1 linha, sem regressao.
Task 3: complete (commits 4ade1d3..7a4d198, review clean)

Task 4: implementada (commit 829b001), status DONE, 12/12 testes, tsc limpo.
Task 4: review 1 — spec OK, qualidade aprovada, 0 Critical. 1 Important, mas de design mandado pelo plano; ver ruling R9.

Ruling R9: aceito a perda de batching do `findUnique` para os models nao escopados. O revisor apontou que reescrever `findUnique` como `findFirst` na camada `$allModels` alcanca tambem User, Session, Account etc., e que `findFirst` nao recebe o dataloader que o Prisma aplica a `findUnique` concorrente. E custo de performance, nao de correcao. Na pratica o app nunca acessa esses models pelo client escopado — BetterAuth e `src/lib/allowlist.ts` usam o PrismaClient cru —, entao o caminho degradado nao e exercitado. Excluir os unscoped da camada `model` acrescentaria uma bifurcacao na parte mais sensivel do arquivo em troca de ganho nulo hoje. Custo se errado: se algum dia codigo quente de autenticacao passar pelo client escopado, chamadas concorrentes de `findUnique` perdem batching e viram N queries; o sintoma seria latencia, nao dado errado, e a correcao continua disponivel.

Task 4: minors deferidos — (a) o teste de `findUnique` cross-tenant prova a existencia do registro alheio implicitamente (o `await create` nao lancou) em vez de por asercao explicita; (b) nao ha teste dedicado de isolamento para `findUniqueOrThrow`, que percorre o mesmo caminho de codigo.
Task 4: complete (commits 7a4d198..829b001, review clean)

Task 5: implementada (commit 2bf4014), status DONE_WITH_CONCERNS, 24/24 testes, tsc limpo. R2 aplicado: `UNSCOPED_MODELS` agora e declarada e exportada so em `nested-writes.ts`, com os oito nomes; `extension.ts` importa.
Task 5: o implementador achou dois testes do brief que passariam por vacuo e os substituiu por testes que exercitam o comportamento real — o de `connect` agora usa `Sale.customer`, a mesma relacao que o teste de `connectOrCreate` injeta, e ele acrescentou um caso `user: { create: {...} }` para exercitar de fato a guarda de model nao escopado.
Task 5: o implementador manteve o `?? {}` em `typed.data` que o Step 5 do plano tinha derrubado. Sem ele, um `create({})` com `data` indefinido perderia o `workspaceId` em silencio — exatamente o registro orfao que a task existe para evitar. Defeito do plano, corrigido por ele.

Ruling R10 (Critical): o walker precisa alcancar tambem `update` e `upsert.update`, nao so os creates. O implementador levantou a lacuna mas concluiu que o padrao nao existia no codigo; verifiquei e existe — `src/server/actions/sales.ts`, funcao `updateSale`, por volta da linha 162, faz `db.sale.update({ where, data: { items: { create: [...] } } })`. Como a Task 9 torna `workspaceId` NOT NULL e a Task 11 migra `sales.ts` para o client escopado, editar uma venda passaria a violar a constraint em producao. A correcao e a variante que ele mesmo descreveu: percorrer os payloads aninhados sem setar `workspaceId` no topo, porque escrever essa coluna num update seria errado. Custo se errado: a variante nova toca o branch mais sensivel da extension; se ela injetar onde nao deve, o sintoma aparece nos testes de isolamento, que cobrem esses caminhos.

Task 5: fix round 1/5 — despachado ao implementador original com o achado Critical (R10) e a citacao do arquivo e linha que contradizem a avaliacao dele.
Task 5: minor deferido para o review final — `UNSCOPED_MODELS` continua mantida a mao; uma asercao cruzando o DMMF (todo model com `workspaceId` esta fora da lista, todo model sem esta dentro) fecharia isso permanentemente.
Task 5: o implementador reconheceu que sua verificacao original estava errada — ele rodou `grep -B2 -A12 ".update(" sales.ts | grep -n "create"`, e o segundo grep filtrou a saida ja recortada em vez do arquivo. Reportou "nao existe" a partir de um comando incapaz de responder a pergunta. Escreveu o teste de integracao antes da correcao e o viu falhar com o `SaleItem` orfao.
Task 5: fix round 1/5 (1 addressed, 0 open; commits 2bf4014..710e7dc) — re-review confirmou: a variante nova nao escreve `workspaceId` no topo, o `where` do `update` continua escopado via `withWhere`, o teste de integracao reproduz a sequencia real de `updateSale`, e nenhum teste antigo foi enfraquecido pela refatoracao sobre `walkRelations`. Suite de 24 para 36.
Task 5: o re-revisor notou um ponto teorico — a heuristica `entry.data === undefined`, que distingue a forma to-many `{where,data}` da to-one direta, quebraria se algum model tivesse campo escalar chamado `data`. Verificou o schema: nao existe. Nao e risco vivo.
Task 5: complete (commits 829b001..710e7dc, review clean)

Task 6: implementada (commit c7c4aa3), status DONE, 36/36 testes, tsc limpo.
Task 6: review 1 — spec OK, qualidade aprovada, zero achados em qualquer nivel. O revisor confirmou a logica de `requireRole` (sem negacao invertida), os dois pontos de lancamento em `getWorkspaceContext`, e verificou de forma independente que o padrao `auth.api.getSession({ headers: await headers() })` e o mesmo usado em treze outros pontos do codebase.
Task 6: complete (commits 710e7dc..c7c4aa3, review clean)

=== FASE 1 COMPLETA === Tasks 1-6. Suite de 36 testes, tsc limpo, app compilando. Multi-tenancy existe no schema e na camada de acesso, mas nenhum arquivo de dominio a consome ainda.

Estado do banco de desenvolvimento local (verificado antes da Task 7): 1 usuario (ferrari.lucasr@gmail.com) e 1 produto. Suficiente para exercitar o backfill de verdade.

Task 7: implementada (commit f16053e), status DONE, 36/36 testes, tsc limpo. R1 aplicado: `DOMAIN_TABLES` vive so em `scripts/domain-tables.ts`.
Task 7: testada de verdade contra o banco local — as tres guardas exercitadas (e-mail inexistente aborta, segunda execucao aborta por idempotencia) e resultado conferido no Postgres: 0 linhas com `workspaceId IS NULL` nas 16 tabelas, 1 Member OWNER.
Task 7: review 1 — spec OK, lista de 16 tabelas conferida contra os `@@map` do schema, guardas falham fechado e a de slug e avaliada antes de qualquer escrita, owner nao duplicado, interpolacao segura. 1 Important: ausencia de transacao.

Ruling R11: o backfill passa a rodar dentro de um unico `db.$transaction`, com `timeout` e `maxWait` explicitos. O plano nao previa transacao. Sem ela, uma falha no meio deixa workspace e members persistidos e parte das tabelas atualizada — e a guarda de idempotencia entao trava a segunda tentativa, prendendo o operador com backfill parcial. A transacao tambem conserta a semantica da guarda: workspace existir passa a significar backfill completo, que e a invariante que ela pressupoe. O timeout explicito e parte inseparavel do fix: o default do Prisma para transacao interativa e 5s, o que passa no banco local (poucos dados) e falharia no banco de producao, na unica execucao que importa. Custo se errado: uma transacao longa segura locks nas 16 tabelas durante o backfill; em producao isso significa fazer numa janela de manutencao, o que ja era o plano.

Task 7: fix round 1/5 — despachado ao implementador original (R11), com instrucao de restaurar o estado do banco local para poder retestar.
Task 7: fix round 1/5 (1 addressed, 0 open; commits f16053e..1b9a21f) — re-review confirmou: nenhum `db.$executeRawUnsafe` sobrevivente (so `tx.`), `timeout`/`maxWait` explicitos, as duas guardas que tocam o banco ficaram dentro da transacao, nenhum `throw` de teste esquecido, contagens corretas.
Task 7: o implementador provou o rollback em vez de assumi-lo — injetou um `throw` temporario no fim do corpo da transacao, depois de todas as escritas, e confirmou o banco intacto (workspaces=0, members=0, NULLs preservados). Observou, com razao, que as guardas sozinhas nao demonstram atomicidade, porque quando disparam nada foi escrito ainda.
Task 7: ele tambem moveu os `console.log` das contagens para depois do commit. Estavam dentro do laco, entao uma transacao abortada imprimiria "X linhas" para updates que seriam revertidos — saida enganosa exatamente no cenario de falha que o fix trata.
Task 7: complete (commits c7c4aa3..1b9a21f, review clean)

Task 8: implementada (commit 0a881d5), status DONE, 36/36 testes, tsc limpo. R1 aplicado: importa `DOMAIN_TABLES` em vez de redeclarar.
Task 8: o Step 3 foi de fato executado — `workspaceId` de um produto zerado via SQL, script retornou exit 1 com `product: 1 linhas sem workspaceId`, valor restaurado, script voltou a exit 0. O relatorio traz a saida real dos dois casos, nao so a afirmacao de ter rodado.
Task 8: review 1 — spec OK, qualidade aprovada, 0 Critical/Important. O revisor confirmou que o laco varre as 16 tabelas sem parar na primeira (coleta em `offenders[]` e so entao decide), que a conversao BigInt->Number esta correta, e que `process.exit(1)` e alcancado incondicionalmente.
Task 8: minor deferido — `process.exit()` no caminho de falha impede o `.finally(() => db.$disconnect())` de rodar; irrelevante para corretude, o SO libera a conexao com o processo.
Task 8: complete (commits 1b9a21f..0a881d5, review clean)

=== PARADA PARA O USUARIO: Task 9 === Usuario autorizou executar a Task 9 apenas no banco local, sem tocar producao (nao ha credenciais de producao neste ambiente), e pediu um runbook para aplicar em producao depois.

Task 9: implementada (commits c4848f7 e 2e0b284), 36/36 testes, migration aplicada sobre os dados backfillados reais. Runbook em `docs/runbooks/2026-08-29-migration-multi-tenant.md`.

DEFEITO ESTRUTURAL DO PLANO, descoberto pela Task 9: com `workspaceId` obrigatorio, o TypeScript passa a exigir o campo em todo `create`, mas a extension o injeta em runtime, onde o compilador nao enxerga. Resultado: 37 erros de `tsc --noEmit`. O mais revelador esta nos testes da propria extension — `scopedDb(a.id).product.create({ data: { name: "Cookie" } })` nao compila, e esse e exatamente o padrao que a Fase 3 usaria. O plano afirmava "o corpo da query nao muda"; isso estava errado. `npm test` continua verde porque o Vitest nao faz type-check.

Distribuicao dos 37 erros: 11 em `src/server/tenant/extension.test.ts`, 18 em `src/server/actions/*` (escopo da Fase 3), 8 em `prisma/seed.ts` — arquivo que NENHUMA task do plano cobre. Gap adicional.

Ruling R12 (decidido pelo usuario entre duas alternativas apresentadas): o codigo de dominio passa `workspaceId` explicitamente nos creates, vindo do contexto de workspace. A alternativa era um mapped type sobre o PrismaClient afrouxando os inputs, que manteria os corpos limpos ao custo de 50-80 linhas de tipos densos, sem dono no projeto e sujeitos a quebrar em upgrade do Prisma. A extension continua sobrescrevendo o valor, entao passar o `workspaceId` errado nao vaza dado — o campo explicito serve ao compilador, e o compilador passa a exigir que se pense nele. Custo se errado: verbosidade em ~18 call sites.

Ruling R13 (meu, derivado de R12): nos TESTES da extension a saida e outra — um cast localizado, nao o campo explicito. O teste "create grava o workspaceId sem que o chamador informe" existe para provar que a extension injeta; se o chamador informar, ele deixa de provar qualquer coisa. Testes que verificam comportamento de runtime que o tipo nao expressa sao o lugar legitimo do cast. Custo se errado: um cast a mais em arquivo de teste.

Ruling R14: o build fica quebrado entre a Task 9 e o fim da Fase 3, e isso e aceito como estado transitorio conhecido. Os 18 erros em `src/server/actions/*` so somem quando esses arquivos passarem a receber `workspaceId`, o que e o trabalho das Tasks 10-12. Reordenar (Fase 3 antes do aperto) evitaria a janela, mas a Task 9 ja esta feita e validada, e refaze-la custaria mais do que a janela vale. Custo se errado: se o trabalho parar no meio da Fase 3, o worktree fica sem compilar — mitigado por estar isolado da main.

Task 9: fix round 1/5 (commits c4848f7..6ce0afa) — seed alinhado (workspace `dev-seed`, separado do `douce-vie`, idempotente) e os 11 casts nos testes da extension. Restaram exatamente 18 erros de tsc, todos em `src/server/actions/*`, como previsto.
Task 9: review 1 — schema e migration OK (16 tabelas, 5 uniques compostas com o `@unique` de coluna de `Customer.email` removido via DROP INDEX, 4 indices, `SET NOT NULL` que preserva dados). Casts conferidos um a um, seed correto. **NAO aprovada: 2 Critical no runbook.**

Task 9 C1 (Critical): o runbook levaria a uma queda de producao. Depois da migration, o codigo no ar continua escrevendo pelo client cru sem `workspaceId` — 8 arquivos importam `@/lib/db` — e toda escrita passa a falhar com not-null violation. Os 18 erros de tsc nao sao divida de tipagem: sao exatamente os caminhos de escrita que quebram. O runbook nao diz que a migration so pode ser aplicada depois da Fase 3 deployada. Achado do revisor, nao meu — eu tinha registrado a janela de build quebrado (R14) sem perceber que ela implicava ordem obrigatoria entre deploy de codigo e migration.

Task 9 C2 (Critical): a regra central do runbook (DIRECT_URL, nunca o pooler) nao vale para os comandos que ele manda rodar. `npm run backfill` e `npm run verify:backfill` usam `dotenv -e .env` e os scripts fazem `new PrismaClient()` sem override, logo leem `DATABASE_URL` — o pooler na 6543. Pior: o backfill abre transacao interativa de 120s atravessando o pooler, que e exatamente o cenario que a secao 1 do runbook descreve como perigoso. Consequencia direta do meu ruling R11, que adicionou a transacao longa sem revisar por qual conexao ela passaria.

Ruling R16: incluir na migration os 8 indices `workspaceId` que faltam (`flavor`, `price_list_item`, `price_history`, `sale_item`, `recipe_ingredient`, `production_batch`, `production_filling`, `shopping_list_item`). O brief so pediu 4 — lacuna do plano, nao desvio da implementacao. Sem eles, toda query escopada e toda validacao de FK nessas tabelas vira seq scan. Incluir agora custa uma linha por model; depois custaria outra migration contra producao. Custo se errado: oito indices a mais ocupando espaco e encarecendo escrita, num volume onde isso e irrelevante.

Ruling R17: os scripts `backfill-workspace.ts` e `verify-backfill.ts` passam a usar explicitamente a conexao direta, em vez de depender de qual variavel o dotenv carregou. Corrige C2 na raiz, em vez de depender de o operador lembrar de prefixar a variavel. Custo se errado: se alguem rodar num ambiente onde so `DATABASE_URL` existe, o script precisa de fallback — a implementacao deve tratar isso.

Task 9: fix round 2/5 — o implementador original falhou duas vezes seguidas por infraestrutura (suspensao do computador, depois stall de 600s), com o transcript ja acima de 198k tokens. Trabalho parcial sobreviveu no working tree, nao commitado: schema com os 8 indices, migration `20260830023313_add_missing_workspace_indexes`, `scripts/direct-database-url.ts` novo, os dois scripts ajustados e as asercoes do teste. O runbook continua na versao original (194 linhas, sem o pre-requisito C1).

Ruling R18: troco de implementador antes do round 4 previsto pelo processo. As duas falhas foram de infraestrutura e tamanho de contexto, nao de capacidade — insistir no mesmo agente repete a condicao que o derrubou. O implementador novo recebe contexto minimo: o estado do working tree, o que falta (runbook) e as verificacoes. Custo se errado: o agente novo pode nao entender decisoes tomadas no transcript antigo; mitigado por elas estarem todas neste ledger e no relatorio da task.

Task 9: fix round 2/5 (9 addressed, 0 open; commits 6ce0afa..d0ae0ce) — C1, C2, I1, I2, I3 e M1-M4 todos confirmados pelo re-review, com verificacao pratica: o fallback de `direct-database-url.ts` funciona e os DOIS scripts o usam; os 8 indices batem entre schema (8 `@@index`) e SQL (8 `CREATE INDEX`), com nomes de tabela conferidos contra os `@@map`; todos os comandos do runbook existem de verdade no package.json; o pre-requisito C1 e a primeira secao do arquivo, antes de qualquer comando.
Task 9: fix round 3/5 — uma quebra cosmetica introduzida pelo proprio fix 2: negrito aninhado com mesmo delimitador nas linhas 12-15 do runbook faz "deployadas em producao" perder a enfase, justamente a palavra mais critica do documento. Despachado ao implementador com pedido de varrer o arquivo atras de outros casos.
Task 9: minor deferido para o review final — nao ha guard-rail em codigo que impeca a migration de aperto de rodar antes da Fase 3 estar deployada, nem que garanta a janela de manutencao. Hoje isso depende so do runbook e de disciplina humana no dia. Levantado pelo implementador; concordo que e trabalho futuro legitimo, nao bloqueio.

Task 9: fix round 3/5 (1 addressed; commit 298dbfe) — negrito corrigido com italico por dentro, arquivo relido sem outras ocorrencias. Verifiquei o trecho eu mesmo: a enfase agora renderiza.
Task 9: complete (commits 0a881d5..298dbfe, review clean)

=== FASE 2 COMPLETA === Tasks 7-9. Backfill atomico e testado, verificacao bloqueante provada nos dois sentidos, migration de aperto aplicada sobre dados reais no banco local, runbook de producao revisado. Estado transitorio conhecido: 18 erros de tsc em `src/server/actions/*`, que a Fase 3 resolve.

Ruling R19: acrescentar a `src/server/tenant/context.ts` um helper que devolve numa unica chamada o client escopado e o `workspaceId` (algo como `getScopedDb(): Promise<{ db, workspaceId, userId, role }>`). Com R12, todo create precisa do `workspaceId`, e o padrao ingenuo seria chamar `getWorkspaceDb()` e `getWorkspaceContext()` em sequencia — duas resolucoes de sessao por request, cada uma com seu `getSession` e sua consulta a `Member`. O helper elimina a duplicacao. As funcoes existentes permanecem para quem so precisa de uma delas. Custo se errado: mais uma funcao na superficie do modulo; se ninguem usar, e codigo morto facil de remover.

Task 10: implementada (commit 2246bf0), review 1 — spec OK, qualidade aprovada. 1 Important: o padrao `requireAdmin() + getScopedDb()` resolvia a sessao duas vezes por action, contradizendo o proposito do helper e o texto do proprio commit.
Task 10: fix round 1/5 (1 addressed, 0 open; commits 2246bf0..38d750d) — `getScopedDb(...allowedRoles)` checa papel internamente, `getWorkspaceContext` memoizado com `cache()` do React (funcionou com `headers()` sem ajuste). Re-review confirmou: a condicao `allowedRoles.length > 0 && !includes(role)` rejeita MEMBER corretamente e o curto-circuito para lista vazia e deliberado, nao efeito colateral; as 8 actions passam OWNER/ADMIN; os 3 creates mantem `workspaceId`; `cache()` esta em `getWorkspaceContext`, nao em `getScopedDb` — memoizar o segundo misturaria a checagem de papel no cache.
Task 10: complete (commits 298dbfe..38d750d, review clean)
Task 10: nota do revisor para as tasks seguintes — `ingredients.ts`, `recipes.ts` e `allowlist.ts` ainda tem funcoes locais `requireAdmin` duplicadas. As Tasks 11 e 12 devem elimina-las; `allowlist.ts` fica de fora por R8.

Task 10: tres interrupcoes de infraestrutura ate aqui (limite de sessao, duas suspensoes do computador). Nenhuma perdeu trabalho — em todas o working tree preservou o parcial e o ledger permitiu reconstituir o estado —, mas cada uma custou uma rodada de verificacao.

Task 11: implementada (commit 3ee5216), 36/36 testes, tsc de 14 para 9 erros.
Task 11: review 1 — spec OK, qualidade aprovada, 0 Critical/Important. O revisor confirmou de forma independente (rodou tsc, nao so confiou no relatorio): `getScopedDb()` sem argumentos nas 9 actions de operacao diaria, `workspaceId` presente nos tres niveis de `createSale`/`updateSale` (topo, itens aninhados e cada stockMovement do laco), `deleteMany` preservando o filtro por `saleId`, `userId` vindo do contexto, e nenhuma regra de negocio alterada — `calcDiscountCents`, `parseDiscount` e a logica de forecast permanecem byte a byte.
Task 11: minor deferido — remocao de 5 comentarios inline pre-existentes em `sales.ts`, fora do escopo pedido pelo brief, ainda que alinhada a regra global do projeto.
Task 11: complete (commits 38d750d..3ee5216, review clean)
Task 11: o revisor da Task 11 caiu por limite de sessao da API e foi redespachado; revisores nao escrevem codigo, entao nada se perdeu.

Task 12: implementada (commit 6c13282). MARCO: `tsc --noEmit` com ZERO erros pela primeira vez no plano, `npm run build` concluindo com 24 paginas, 36/36 testes. O estado transitorio de build quebrado aceito em R14 esta fechado.
Task 12: review 1 — spec OK, qualidade aprovada, ZERO achados em qualquer nivel. O revisor verificou de forma independente: divisao de papeis em `markets.ts` correta (cadastro de mercado exige OWNER/ADMIN, compra de ingrediente nao), `workspaceId` presente inclusive nos creates aninhados (`recipeIngredient.createMany` dentro da transacao e `ingredients: { create: [...] }` dentro de `recipe.create`), `buildConsumptionMap` com assinatura nova e chamador unico atualizado, e nenhuma regra de negocio alterada — ele isolou todas as linhas adicionadas e confirmou que so restava reformatacao de literal e a passagem do `db`.
Task 12: complete (commits 3ee5216..6c13282, review clean)

Task 13: implementada (commit 74b81a7), status DONE_WITH_CONCERNS. R4 aplicado: `eslint.config.mjs` criado do zero com FlatCompat + `next/core-web-vitals` mais a regra. R8 aplicado: `ignores` cobre `src/server/tenant/**` e `src/server/actions/allowlist.ts`. As quatro verificacoes passaram, incluindo a prova de que a regra dispara e de que as excecoes funcionam.

Ruling R20: aceito a config de lint **sem** `next/typescript`. Liga-lo acusaria 7 violacoes pre-existentes e sem relacao com este plano (imports nao usados, interfaces vazias em componentes shadcn), nunca detectadas porque o projeto nao tinha config de ESLint e o lint nunca rodou. Corrigi-las aqui expandiria o escopo da ultima task do plano para limpeza de codigo alheio; deixa-las quebrando o lint tornaria a regra nova inutil, porque ninguem roda um lint que sempre falha. Nao ha regressao: o projeto nao tinha lint algum antes. Custo se errado: a cobertura de lint fica abaixo do padrao `create-next-app` ate alguem ligar `next/typescript` e tratar as 7 violacoes — trabalho pequeno e isolado, registrado para o review final.

Ruling R21: aceito o fix cosmetico incidental em `src/components/customers/customer-combobox.tsx:249` (aspas retas viraram entidade HTML, `react/no-unescaped-entities`). Esta fora do escopo literal do brief, mas era obrigatorio para a verificacao 4 (lint limpo) passar. Custo se errado: uma linha de componente alterada sem relacao com multi-tenancy; visivel no diff e trivial de reverter.

Task 13: review 1 — spec OK, qualidade aprovada, 0 Critical/Important. O revisor testou empiricamente em vez de so ler: criou arquivos temporarios em quatro profundidades sob `src/server/` (todos dispararam), um vizinho de `allowlist.ts` na mesma pasta (disparou, provando que a excecao e exata e nao vaza para a pasta inteira), um aninhado em `src/server/tenant/sub/` (nao disparou, provando que a excecao cobre subpastas), e as tres formas de import — nomeado, default e namespace — todas bloqueadas. Rodou `eslint --print-config` e contou 31 regras ativas de react/hooks/jsx-a11y/next, confirmando que `next/core-web-vitals` esta aplicado e nao e import morto.
Task 13: minor deferido para o review final — `files: ["src/server/**/*.ts"]` nao cobre `.tsx`. Hoje nao existe nenhum `.tsx` sob `src/server/`, entao nao e gap real; vira um se algum dia aparecer. Correcao seria trocar por `*.{ts,tsx}`.
Task 13: complete (commits 6c13282..74b81a7, review clean)

=== PLANO COMPLETO === 13 de 13 tasks. Fase 1 (fundacao), Fase 2 (backfill e aperto) e Fase 3 (camada de acesso) fechadas. Estado final: tsc limpo, lint limpo, build concluindo, 36 testes passando.

=== REVIEW FINAL DA BRANCH === Veredicto: NAO pode ser mesclada como esta. 3 Critical, 4 Important, 10 Minor.

C1 (Critical): quatro paginas em `src/app/` — products/new, products/[id]/edit, admin/catalog e markets — leem o banco pelo client cru, 8 chamadas sem escopo, fora do alcance da regra de lint (que so cobre `src/server/**`). Com dois workspaces, a pagina lista dados de todos. **A origem e o spec**, secao 5.1: "Todo arquivo em `src/server/`". Eu herdei esse recorte no plano, contei "16 arquivos em `src/server/` importam `@/lib/db`" e nunca varri `src/app/`. Um `grep -rl "@/lib/db" src/` no pre-flight teria mostrado. Falha minha de recorte, nao de execucao.

C2 (Critical): a extension e fail-open — operacoes fora da cadeia de `if` caem num `return query(typed)` sem escopo. Verificado empiricamente contra o Prisma 6.19.3: `updateManyAndReturn` alterou linhas de tres workspaces e `createManyAndReturn` gravou em outro workspace a partir de um client preso a A. Contradiz diretamente a justificativa do spec 3.1 ("o modo seguro precisa ser o padrao, nao a disciplina"). Nenhum teste pegaria: acrescentar essas operacoes ao codigo de producao nao deixaria um unico teste vermelho.

C3 (Critical): o runbook nunca aplica a migration aditiva. Producao nao tem nenhuma das tres migrations; executando o documento, o pre-requisito manda deployar a Fase 3 primeiro, cujo codigo consulta a tabela `member` inexistente — app inteiro fora do ar, nao so escritas. O passo 3 roda o backfill contra tabelas que nao existem, e o passo 5 aplicaria aditiva e aperto juntas, depois do backfill que deveria rodar entre as duas.

Ruling R22 (I1 — FK cross-workspace): registro como limitacao conhecida e adio para o proximo plano. A extension escopa o `where` de topo e nunca a travessia de relacao: uma `Sale` de A com `customerId` de B, lida com `include`, devolve o cliente de B. As actions aceitam ids de FK direto do FormData sem checar dono. Fechar isso exige FK composta `(parentId, workspaceId)` — com `@@unique([id, workspaceId])` nos pais e uma quarta migration — ou validacao explicita em ~8 actions. Com C1 corrigido, explorar isso exige adivinhar um cuid, e existe um unico tenant hoje. Custo se errado: se a Fase 4 entregar multiplos workspaces antes de isso ser fechado, um id vazado ou adivinhado cruza a fronteira. Entra como item obrigatorio do plano de workspaces.

Ruling R23 (I2 — `activeWorkspaceId` ignorado): confirmo que e desvio do spec 5.1 e registro explicitamente. `getWorkspaceContext` resolve pelo `Member` mais antigo; a coluna `Session.activeWorkspaceId` existe no schema e nao e lida em lugar nenhum. Isso e aceitavel enquanto ha um tenant, mas vira dado errado e silencioso no dia em que a Fase 4 entregar o seletor de workspace: trocar de workspace pareceria funcionar na UI enquanto as queries continuariam na associacao mais antiga. Custo se errado: nenhum hoje; alto se a Fase 4 nao comecar por aqui. Entra como primeiro item do plano de workspaces.

Ruling R24 (I3 — cobertura): aceito que a suite prova o mecanismo num model, nao isolamento no conjunto. O revisor tem razao: 13 casos quase todos sobre `Product`, sem teste afirmando QUAIS operacoes sao escopadas — e por isso C2 e invisivel para ela. A correcao de C2 traz testes de operacao, e I4 traz a asercao DMMF. A cobertura por operacao x modelo pedida pelo spec 11 fica para o proximo plano. Custo se errado: uma regressao de escopo num model nao coberto passaria.

Onda unica de correcao despachada: C1, C2, C3, I4, M2, M7.
Minors adiados por decisao do revisor final e minha: M1 (findUnique deixou de ser PrismaPromise — quebra `$transaction([...])` e fluent API, sem uso hoje), M3 (coberto por C1), M4 (`requireRole` virou codigo morto), M5 (`isAdmin()` ainda le o role global — Fase 4), M6 (erros do contexto viram 500 em vez de ActionResult), M8 (memoizacao de `scopedDb`), M9 (dois passos do runbook sem dizer como executar o SQL), M10 (yarn.lock e pnpm-lock.yaml devem ser apagados).

=== ONDA DE CORRECAO DO REVIEW FINAL === 5 commits (74b81a7..6de943a), 43 testes (era 36). C1, C2, C3, I4, M2 e M7 todos ADDRESSED, verificados empiricamente pelo re-review: o fail-closed foi conferido enumerando as 19 operacoes do delegate Prisma real (nenhuma operacao de model passa sem escopo); a regra de lint foi testada nas formas `@/lib/db`, relativa e `@/lib/../lib/db`, todas bloqueadas; o runbook teve os comandos conferidos contra o repo (16 SET NOT NULL, 8 CREATE INDEX, scripts existentes).

Achados novos trazidos pela propria onda: (a) `no-restricted-imports` com `paths` casa a string do import, nao o modulo — alargar o `files` sem `patterns: ["**/lib/db"]` deixaria a regra contornavel com caminho relativo, e o C1 voltaria por outra porta; (b) a asercao DMMF pegou divergencia real na primeira execucao (`Member` e `Invitation` tem `workspaceId` e estao em UNSCOPED_MODELS) — nao e bug, escopar `Member` seria circular porque e a tabela que descobre o workspace, e a excecao foi tornada explicita em vez de a asercao ser afrouxada; (c) simulando o runbook em banco descartavel, descobriu-se que aplicar o aperto sem backfill nao so falha como trava todo deploy seguinte com P3018 — virou entrada propria de rollback.

Ruling R25 (residual do re-review final): aceito como follow-up, nao bloqueio. O `workspaceId` dentro de `data` nao e sobrescrito em `update`/`updateMany`/`updateManyAndReturn` — verificado contra o banco real, `scopedDb(A).product.update({ where, data: { workspaceId: B } })` move a linha para B. Nao e leitura cross-tenant, e doacao de linha. Tres razoes para nao bloquear: nao e regressao (o estado anterior tinha o mesmo tratamento, e para `updateManyAndReturn` o diff e estritamente melhora); nao e alcancavel hoje (nenhuma action espalha input do usuario dentro de `data` — buscas por `...parsed`, `...input`, `...values`, `...data` em actions e queries retornaram zero); e a correcao e pequena e localizada, do mesmo jeito que o ramo de create ja faz. Custo se errado: se alguem passar a montar `data` por spread de input, uma linha pode ser doada a outro workspace. Entra como primeiro follow-up.

Ruling R26: avisar o time antes do merge sobre o checksum das migrations. Quem ja puxou a branch e aplicou as migrations no banco local vai encontrar checksum divergente (o `IF EXISTS` do M7 mudou o SQL), e `npm run db:migrate` oferece **reset do banco**. Para producao o risco e zero, porque nenhuma das tres migrations foi aplicada la. Custo se errado: alguem aperta enter sem ler e perde o banco local de desenvolvimento.

Ruling R15: `prisma/seed.ts` entra no escopo da Fase 3, na Task 12. Foi resolvido antes, dentro da Task 9. Ja foi resolvido antes, dentro da Task 9 (workspace `dev-seed`), porque quebrava o `tsc` junto com os testes. O plano nao o menciona em nenhuma task, mas ele quebra pelo mesmo motivo e faz parte do fluxo de desenvolvimento (`npm run db:seed`). Precisa criar ou reusar um workspace e passar o `workspaceId`. Custo se errado: o seed continua quebrado e o setup de um dev novo falha.

Task 7: o primeiro fix round foi interrompido por limite de sessao da API antes de qualquer escrita. Estado verificado na retomada: HEAD continua em f16053e, `scripts/backfill-workspace.ts` sem transacao, working tree so com o ruido pre-existente (tsconfig.tsbuildinfo, yarn.lock). O banco local mantem o workspace `douce-vie` do backfill anterior, entao o retestar exige restaurar antes. Fix redespachado do zero ao mesmo implementador.

Nota sobre a Task 6: o plano nao prescreve testes para ela — os tres steps sao implementar, `tsc` e commit. Nao e omissao a corrigir: `getWorkspaceContext` depende de `headers()` do Next, que exige contexto de request e nao se exercita em teste unitario sem infraestrutura que o plano nao monta. As funcoes passam a ser exercitadas de fato na Fase 3, quando os arquivos de dominio as consomem.


---

## Execucao em producao — 2026-08-30

Aplicada com sucesso. O ambiente mudou entre o planejamento e a execucao: o app saiu da Vercel para um Coolify em VPS propria, e o banco saiu do Supabase para um Postgres na mesma VPS. O runbook foi escrito assumindo Supabase e Vercel, mas a sequencia continuou valida.

Duas coisas que o runbook nao previa apareceram:

**Havia uma quarta migration pendente.** `20260622_stock_movement_batch_relation`, de junho, nunca aplicada nesse banco. O runbook assumia exatamente tres pendentes e mandava conferir isso apos o passo 4. Ela contem um `DELETE FROM stock_movement` de linhas orfas — verificamos antes de aplicar que afetaria zero linhas (304 movimentos, nenhum orfao), e so entao rodamos. Aplicada antes da aditiva.

**O start command do Coolify roda `prisma migrate deploy`.** Ou seja, o passo 8 — o irreversivel — nao foi um comando manual: aconteceu sozinho quando o deploy do codigo da Fase 3 subiu. Isso foi seguro porque backfill e verificacao ja tinham passado, mas inverte o desenho do runbook, que previa uma confirmacao humana antes desse passo. Se o primeiro deploy tivesse funcionado antes do backfill, a migration de aperto teria falhado e travado todos os deploys seguintes com P3018.

Dois builds falharam antes de passar. O primeiro por `ERR_PNPM_OUTDATED_LOCKFILE`: o deploy usa **pnpm**, mas as dependencias de teste e lint foram adicionadas com npm durante a implementacao, deixando o `pnpm-lock.yaml` defasado. Isso e consequencia direta da Global Constraint do plano ter fixado npm com base no README, sem verificar como o deploy roda. O segundo build morreu na fase de type-check do Next, sem mensagem — resolvido do lado da infraestrutura.

Titularidade corrigida apos o backfill: o `OWNER` do workspace e a dona do negocio (jenifer270300@gmail.com), nao o desenvolvedor, que ficou como `ADMIN`. Hoje os dois papeis tem os mesmos poderes; a distincao passa a valer na Fase 4 e no billing, onde a assinatura se associa ao OWNER.

Estado final verificado no banco: 9 migrations aplicadas, 18 colunas `workspaceId` nenhuma nullable, 19 indices, 18 foreign keys, 1 workspace. Contagens identicas as de antes do backfill — 235 vendas, 303 itens, 71 clientes, 3 produtos, 304 movimentos. Venda de teste criada pela UI em producao exercitou o caminho completo (sale + sale_item aninhado + stock_movement) com sucesso.
