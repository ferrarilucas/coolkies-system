-- Escrita a mao (sem prisma migrate dev): historico de migrations do banco de
-- dev esta divergente do schema versionado, e migrate dev propunha um reset.

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN "authorizedAt" TIMESTAMP(3);
ALTER TABLE "subscription" ALTER COLUMN "plan" SET DEFAULT 'corre';

-- "solo" saiu do catalogo quando os planos foram renomeados; quem ainda
-- estiver com o valor antigo (por ter usado o default de antes desta
-- migration) passa para o id equivalente atual.
UPDATE "subscription" SET "plan" = 'corre' WHERE "plan" = 'solo';

-- Backfill: quem ja tem graceGrantedAt gravado comprovadamente ja recebeu
-- uma autorizacao (era o unico jeito de conceder carencia). authorizedAt
-- passa a existir para separar "autorizou" (tela) de "tem ponte de acesso"
-- (regra), mas para o historico anterior a essa separacao o melhor instante
-- conhecido de autorizacao e o mesmo em que a carencia foi concedida.
UPDATE "subscription"
SET "authorizedAt" = "graceGrantedAt"
WHERE "graceGrantedAt" IS NOT NULL;
