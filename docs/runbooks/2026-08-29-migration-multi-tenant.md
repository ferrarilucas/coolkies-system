# Runbook: migration multi-tenant em produção (Douce Vie)

Este runbook aplica em produção o trabalho já validado localmente: workspace por
tenant, `workspaceId` obrigatório em todas as tabelas de domínio, uniques e índices
compostos por workspace. Siga a ordem abaixo sem pular etapas — a migration de
aperto (passo 5) é irreversível sem restaurar o dump do passo 2.

Todos os comandos abaixo assumem que você está na raiz do projeto, com as
dependências instaladas (`npm install`).

## ⚠️ Pré-requisito bloqueante: código antes da migration

**Não aplique este runbook até as Tasks 10, 11 e 12 (Fase 3 — migração de
`src/server/actions/*` para `getWorkspaceDb()`) estarem implementadas e
**deployadas em produção**.**

Hoje, 8 arquivos ainda escrevem pelo client cru importado de `@/lib/db`, sem
informar `workspaceId`:

- `src/server/actions/customers.ts`
- `src/server/actions/ingredients.ts`
- `src/server/actions/production.ts`
- `src/server/actions/allowlist.ts`
- `src/server/actions/recipes.ts`
- `src/server/actions/sales.ts`
- `src/server/actions/markets.ts`
- `src/server/actions/catalog.ts`

A migration de aperto (passo 5) torna `workspaceId` **`NOT NULL`** em todas as
tabelas de domínio. Se ela for aplicada antes de esses 8 arquivos estarem
migrados e o novo código estar rodando em produção, **toda escrita feita por
eles passa a falhar** com violação de not-null — registrar uma venda, cadastrar
um cliente, lançar uma produção, tudo. O app fica no ar, mas incapaz de
gravar nada nessas telas.

A ordem correta é sempre **código primeiro, migration depois**:

1. Implementar e revisar as Tasks 10–12.
2. Deployar esse código em produção e confirmar que está servindo tráfego.
3. Só então seguir com este runbook a partir do passo 1 abaixo.

Se você chegou aqui sem ter certeza de que as Tasks 10–12 já estão no ar, **pare
agora** e confirme antes de continuar. Não existe correção rápida depois que a
migration for aplicada fora de ordem além de reverter a migration inteira
(passo 7) e recomeçar.

## 1. Pré-requisitos: qual conexão usar

Use sempre `DIRECT_URL` — a conexão **direta** ao Postgres, na porta **5432**.
**Nunca** use o pooler (porta 6543, `DATABASE_URL`) para dump, backfill ou
migration.

Por quê: o pooler roda em modo *transaction* com `connection_limit=1`. Ele não
sustenta uma sessão longa nem múltiplas conexões simultâneas, que é exatamente o
que `pg_dump`, o script de backfill (que abre uma transação com `timeout: 120000`)
e o `prisma migrate deploy` precisam. Rodar qualquer um desses comandos contra o
pooler pode travar a conexão ou cortá-la no meio, deixando o banco em estado
inconsistente.

Os scripts `npm run backfill` e `npm run verify:backfill` já garantem isso
internamente: eles abrem o `PrismaClient` com `datasources.db.url` apontando
para `DIRECT_URL` (com fallback para `DATABASE_URL` só se `DIRECT_URL` não
estiver definida — veja `scripts/direct-database-url.ts`), então usam sempre a
conexão direta independentemente de qual variável o restante do ambiente
carregou por último. Isso não muda a necessidade de cuidado nos comandos
manuais abaixo (`pg_dump`, `psql`, `prisma migrate deploy`), que continuam
lendo a variável de ambiente do shell diretamente — só nos scripts do projeto.

**Cuidado com qual `.env` está em jogo — dois mecanismos diferentes:**

- `npm run backfill` e `npm run verify:backfill` rodam via
  `dotenv -e .env -- tsx ...` (veja `package.json`). Isso lê o **arquivo
  `.env` na raiz do projeto, no disco**, não variáveis exportadas no shell.
  Antes de rodar qualquer um dos dois, confirme com `cat .env | grep -E
  'DIRECT_URL|DATABASE_URL'` que o arquivo tem as credenciais de **produção**
  — e não as de desenvolvimento local que normalmente ficam lá. Rodar o
  backfill com o `.env` local ainda no lugar aplica tudo no banco local, sem
  aviso.
- `pg_dump`, `psql` e `npx prisma migrate deploy` (passos 2, 5 e 6) usam a
  variável `$DIRECT_URL` exportada no **shell**, não o arquivo. Exporte-a
  explicitamente antes desses comandos, por exemplo lendo o mesmo `.env` de
  produção: `set -a; source .env; set +a` — e confira com `echo $DIRECT_URL`
  que aponta para o host de produção antes de prosseguir.

Confirme antes de seguir que a `DIRECT_URL` que você vai usar — tanto no
arquivo `.env` quanto exportada no shell — é a de produção.

## 2. Dump completo do banco e contagens de referência

```bash
pg_dump "$DIRECT_URL" -Fc -f backup-antes-do-aperto-$(date +%Y%m%d-%H%M).dump
```

`-Fc` gera o dump no formato *custom* do Postgres (comprimido, restaurável com
`pg_restore`).

Depois de rodar, confirme que o arquivo existe e tem tamanho plausível antes de
seguir para o próximo passo — um dump vazio ou truncado (poucos KB, quando o banco
tem milhares de linhas) significa que algo deu errado na conexão e você não tem
uma cópia de segurança de verdade:

```bash
ls -lh backup-antes-do-aperto-*.dump
```

Se o tamanho não bater com o que você espera do banco de produção, **não
prossiga** — investigue a conexão antes de continuar.

Aproveite esta mesma janela para anotar as contagens de referência que serão
comparadas no passo 6, depois da migration:

```sql
SELECT 'product' AS t, count(*) FROM product
UNION ALL SELECT 'sale', count(*) FROM sale
UNION ALL SELECT 'sale_item', count(*) FROM sale_item;
```

Guarde esse resultado (cole num lugar que você vá reabrir no passo 6) — sem ele
não há como confirmar que a migration não perdeu nem duplicou linhas.

## 3. Janela de manutenção e backfill do workspace Douce Vie

**A partir daqui até o fim do passo 6, a aplicação não pode aceitar escritas.**
Qualquer linha criada pelo app entre agora e o fim da migration de aperto entra
com `workspaceId NULL`, e isso derruba o `ALTER COLUMN ... SET NOT NULL` do
passo 5 (ou, pior, passa despercebido pela verificação do passo 4 se a escrita
acontecer depois dela). Coloque a aplicação em modo de manutenção / leitura —
pause o deploy, escale para zero instâncias ou redirecione o tráfego para uma
página de manutenção, conforme o mecanismo disponível na sua hospedagem — e só
libere as escritas de novo depois de confirmar sucesso no passo 6.

Com a aplicação parada para escrita:

```bash
npm run backfill -- <email-do-owner>
```

Substitua `<email-do-owner>` pelo e-mail real do usuário que será o `OWNER` do
workspace (precisa já existir como `User` no banco).

O script (`scripts/backfill-workspace.ts`) roda em uma única transação, contra
a conexão direta (`DIRECT_URL`, com fallback para `DATABASE_URL` — veja passo
1): cria o workspace `Douce Vie` (slug `douce-vie`), torna o dono do e-mail
informado `OWNER`, adiciona os demais usuários existentes como `MEMBER`, e
preenche `workspaceId` em todas as tabelas de domínio listadas em
`scripts/domain-tables.ts` onde ele estiver `NULL`.

A saída esperada é uma linha por tabela com a contagem de linhas atualizadas,
seguida de um resumo:

```
product: 42 linhas
sale: 118 linhas
...
Workspace Douce Vie criado: <id>
Owner: <email-do-owner>
Membros adicionais: <n>
```

Se o script falhar (por exemplo, "Nenhum usuário com o e-mail ... Backfill
abortado" ou "Workspace douce-vie já existe"), a transação é revertida
automaticamente — nada fica parcialmente aplicado. Corrija a causa antes de rodar
de novo. A aplicação continua em modo de manutenção enquanto isso.

## 4. Verificação bloqueante

```bash
npm run verify:backfill
```

Essa é a trava de segurança antes da migration de aperto. O script
(`scripts/verify-backfill.ts`), também contra a conexão direta, conta em cada
uma das tabelas de domínio quantas linhas ainda têm `workspaceId IS NULL`.

**Regra: se a saída não for exit code 0, pare.** Um exit code diferente de 0
significa que existem linhas sem `workspaceId` — aplicar a migration de aperto
nesse estado faria o `ALTER COLUMN ... SET NOT NULL` falhar no meio, ou pior,
poderia falhar em uma tabela e não em outra. Volte ao passo 3, entenda por que
sobraram linhas sem workspace, e só depois repita a verificação. A aplicação
permanece em modo de manutenção até este passo passar.

## 5. Migration de aperto

Com a verificação em exit 0, aplique a migration já commitada no repositório:

```bash
npx prisma migrate deploy
```

Isso aplica todas as migrations pendentes em ordem, incluindo a de aperto
(`prisma/migrations/20260830020652_enforce_workspace_scope/migration.sql`), que
torna `workspaceId` `NOT NULL` em todas as 16 tabelas de domínio, declara as
foreign keys para `workspace`, troca as uniques globais (`name`, `email`) por
compostas (`workspaceId` + campo), e recria os índices com `workspaceId` na
frente — inclusive os 8 índices adicionados em
`prisma/migrations/20260830023313_add_missing_workspace_indexes/migration.sql`
(`Flavor`, `PriceListItem`, `PriceHistory`, `SaleItem`, `RecipeIngredient`,
`ProductionBatch`, `ProductionFilling`, `ShoppingListItem`).

Não use `prisma migrate dev` em produção — esse comando é interativo e pode
oferecer resetar o banco, o que apagaria os dados. `migrate deploy` só aplica
migrations já geradas e commitadas, sem prompts.

## 6. Como confirmar sucesso

Depois do `migrate deploy` terminar sem erro, confirme:

```bash
npx prisma migrate status
```

Deve mostrar "Database schema is up to date!".

Em seguida, rode a verificação de backfill de novo — ela deve continuar passando
(agora é redundante, já que a coluna é `NOT NULL`, mas serve de dupla-checagem):

```bash
npm run verify:backfill
```

Por fim, confira que os dados de negócio continuam intactos comparando com as
contagens anotadas no passo 2:

```sql
SELECT 'product' AS t, count(*) FROM product
UNION ALL SELECT 'sale', count(*) FROM sale
UNION ALL SELECT 'sale_item', count(*) FROM sale_item;
```

As contagens antes e depois da migration devem ser idênticas — a migration só
altera colunas e índices, nunca linhas.

Só com essas três verificações confirmadas, **tire a aplicação do modo de
manutenção** e libere as escritas de novo.

## 7. Como reverter, etapa por etapa

- **Falhou no passo 2 (dump):** nada foi alterado no banco. Investigue a conexão
  (`DIRECT_URL` correta? porta 5432 acessível?) e repita o passo 2. A aplicação
  ainda nem entrou em modo de manutenção.

- **Falhou no passo 3 (backfill):** o script roda em transação — uma falha no
  meio já desfaz tudo sozinha. Confirme com uma query rápida que o workspace
  `douce-vie` não existe (`SELECT * FROM workspace WHERE slug = 'douce-vie'`) antes
  de tentar de novo. A aplicação continua em modo de manutenção.

- **Falhou no passo 4 (verificação):** não é uma falha de banco, é um sinal de
  parada. Volte ao passo 3. A aplicação continua em modo de manutenção.

- **Falhou no passo 5 (migration de aperto):** este é o único ponto realmente
  arriscado. Se `prisma migrate deploy` retornar erro no meio da aplicação da
  migration, restaure o dump do passo 2:

  ```bash
  pg_restore --clean --if-exists -d "$DIRECT_URL" backup-antes-do-aperto-<timestamp>.dump
  ```

  **Ensaie este restore antes de precisar dele de verdade.** `pg_restore
  --clean --if-exists` contra um Postgres gerenciado (Supabase) costuma
  falhar em objetos que o role da aplicação não possui — é comum ver erros de
  permissão em `DROP`/`ALTER OWNER` durante o restore, mesmo quando o restore
  em si é bem-sucedido no que importa. Teste o comando completo, com um dump
  real, contra um banco descartável (uma branch do Supabase ou um Postgres
  local carregado a partir do mesmo dump) antes do dia da migration, para
  saber de antemão quais erros são esperados e inofensivos e quais indicam que
  o restore de fato falhou.

  Depois de restaurar, rode `npx prisma migrate status` para confirmar que o
  banco voltou ao estado anterior à migration de aperto (deve mostrar a migration
  `20260830020652_enforce_workspace_scope` como pendente, não aplicada).

  Investigue a causa raiz antes de tentar de novo. A causa mais provável **não**
  é duplicidade de `name` ou `email` dentro do mesmo workspace — isso não é
  alcançável: as uniques globais antigas (`name`, `email` sozinhos) eram
  estritamente mais fortes que as compostas novas (`workspaceId` + campo), então
  nenhum dado que já satisfazia a unique antiga pode violar a nova. A causa real
  mais provável é uma linha **nova**, com `workspaceId NULL`, escrita pelo app
  depois da verificação do passo 4 — sinal de que a janela de manutenção do
  passo 3 não foi respeitada. Confirme isso e reforce o modo de manutenção antes
  de repetir o processo.

## 8. Por que a ordem importa: aditiva → backfill → aperto

O schema evoluiu em três estágios, e essa ordem não é arbitrária:

1. **Aditiva** (`20260829235758_add_workspace_models_and_nullable_workspace_id`):
   cria `Workspace`, `Member`, `Invitation` e adiciona `workspaceId` como coluna
   **opcional** em todas as tabelas de domínio. Nesse estado, o app continua
   funcionando normalmente com linhas antigas sem workspace.

2. **Backfill** (passo 3 deste runbook): preenche `workspaceId` em todas as linhas
   existentes, atribuindo tudo ao workspace Douce Vie.

3. **Aperto** (passo 5 deste runbook): só agora torna `workspaceId`
   **obrigatório** e cria as uniques/índices compostos.

A migration de aperto **não pode rodar antes do backfill** porque
`ALTER COLUMN "workspaceId" SET NOT NULL` falha imediatamente se existir uma
única linha com `workspaceId IS NULL` — e antes do backfill, é exatamente isso
que existe: todo o histórico de dados de produção. Rodar o aperto fora de ordem
não corrompe dados, mas trava a migration inteira com um erro de constraint, sem
deixar o banco em um estado intermediário utilizável.

Essa ordem de schema (aditiva → backfill → aperto) é independente da outra
ordem, mais ampla, que este runbook exige no topo: **código (Tasks 10–12)
deployado antes do aperto**. As duas travas existem porque protegem coisas
diferentes — uma protege a migration em si de falhar no meio; a outra protege
o app em produção de começar a rejeitar escritas assim que a migration
terminar com sucesso.
