# Runbook: migration multi-tenant em produção (Douce Vie)

Este runbook aplica em produção o trabalho já validado localmente: workspace por
tenant, `workspaceId` obrigatório em todas as tabelas de domínio, uniques e índices
compostos por workspace. Siga a ordem abaixo sem pular etapas — a migration de
aperto (passo 5) é irreversível sem restaurar o dump do passo 2.

Todos os comandos abaixo assumem que você está na raiz do projeto, com as
dependências instaladas (`npm install`) e o `.env` de produção carregado no shell.

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

Confirme antes de seguir que a variável que você vai usar nos comandos abaixo é a
`DIRECT_URL` de produção, não a `DATABASE_URL`.

## 2. Dump completo do banco

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

## 3. Backfill do workspace Douce Vie

```bash
npm run backfill -- <email-do-owner>
```

Substitua `<email-do-owner>` pelo e-mail real do usuário que será o `OWNER` do
workspace (precisa já existir como `User` no banco).

O script (`scripts/backfill-workspace.ts`) roda em uma única transação: cria o
workspace `Douce Vie` (slug `douce-vie`), torna o dono do e-mail informado
`OWNER`, adiciona os demais usuários existentes como `MEMBER`, e preenche
`workspaceId` em todas as tabelas de domínio listadas em
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
de novo.

## 4. Verificação bloqueante

```bash
npm run verify:backfill
```

Essa é a trava de segurança antes da migration de aperto. O script
(`scripts/verify-backfill.ts`) conta, em cada uma das tabelas de domínio, quantas
linhas ainda têm `workspaceId IS NULL`.

**Regra: se a saída não for exit code 0, pare.** Um exit code diferente de 0
significa que existem linhas sem `workspaceId` — aplicar a migration de aperto
nesse estado faria o `ALTER COLUMN ... SET NOT NULL` falhar no meio, ou pior,
poderia falhar em uma tabela e não em outra. Volte ao passo 3, entenda por que
sobraram linhas sem workspace, e só depois repita a verificação.

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
frente.

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

Por fim, confira que os dados de negócio continuam intactos comparando contagens
de antes e depois da migration (anote as contagens do passo 2 e compare aqui — as
tabelas mais representativas são `product`, `sale` e `sale_item`):

```sql
SELECT 'product' AS t, count(*) FROM product
UNION ALL SELECT 'sale', count(*) FROM sale
UNION ALL SELECT 'sale_item', count(*) FROM sale_item;
```

As contagens antes e depois da migration devem ser idênticas — a migration só
altera colunas e índices, nunca linhas.

## 7. Como reverter, etapa por etapa

- **Falhou no passo 2 (dump):** nada foi alterado no banco. Investigue a conexão
  (`DIRECT_URL` correta? porta 5432 acessível?) e repita o passo 2.

- **Falhou no passo 3 (backfill):** o script roda em transação — uma falha no
  meio já desfaz tudo sozinha. Confirme com uma query rápida que o workspace
  `douce-vie` não existe (`SELECT * FROM workspace WHERE slug = 'douce-vie'`) antes
  de tentar de novo.

- **Falhou no passo 4 (verificação):** não é uma falha de banco, é um sinal de
  parada. Volte ao passo 3.

- **Falhou no passo 5 (migration de aperto):** este é o único ponto realmente
  arriscado. Se `prisma migrate deploy` retornar erro no meio da aplicação da
  migration (por exemplo, uma unique constraint violada por dados duplicados que
  a verificação do passo 4 não pegou, já que ela só checa `NULL`, não
  duplicidade), restaure o dump do passo 2:

  ```bash
  pg_restore --clean --if-exists -d "$DIRECT_URL" backup-antes-do-aperto-<timestamp>.dump
  ```

  Depois de restaurar, rode `npx prisma migrate status` para confirmar que o
  banco voltou ao estado anterior à migration de aperto (deve mostrar a migration
  `20260830020652_enforce_workspace_scope` como pendente, não aplicada). Investigue
  a causa raiz (provavelmente duplicidade de `name` ou `email` dentro do mesmo
  workspace) antes de tentar de novo.

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
