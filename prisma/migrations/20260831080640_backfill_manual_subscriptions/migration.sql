-- Backfill: assinatura MANUAL ativa para quem ja era dono de workspace antes do billing existir
INSERT INTO "subscription" (
    "id",
    "userId",
    "plan",
    "status",
    "source",
    "cycle",
    "trialEndsAt",
    "graceUntil",
    "notes",
    "createdAt",
    "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    m."userId",
    CASE
        WHEN COUNT(*) = 1 THEN 'solo'
        WHEN COUNT(*) <= 4 THEN 'team'
        ELSE 'unlimited'
    END,
    'ACTIVE',
    'MANUAL',
    'MONTHLY',
    NULL,
    NULL,
    'Migracao da base pre-billing: dono de workspace anterior a cobranca, liberado sem trial e sem cobranca ate a equipe negociar um plano.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "member" m
WHERE m."role" = 'OWNER'
  AND NOT EXISTS (
    SELECT 1 FROM "subscription" s WHERE s."userId" = m."userId"
  )
GROUP BY m."userId";
