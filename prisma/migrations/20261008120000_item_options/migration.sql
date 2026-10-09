BEGIN;

CREATE TABLE IF NOT EXISTS "item_option" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "item_option_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_option_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_option_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "item_option_value" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "item_option_value_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_option_value_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "item_option"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_option_value_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "variant_option_value" (
    "variantId" TEXT NOT NULL,
    "optionValueId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "variant_option_value_pkey" PRIMARY KEY ("variantId", "optionValueId"),
    CONSTRAINT "variant_option_value_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "variant_option_value_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "item_option_value"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "variant_option_value_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "item_option_workspaceId_idx" ON "item_option"("workspaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "item_option_itemId_name_key" ON "item_option"("itemId", "name");
CREATE INDEX IF NOT EXISTS "item_option_value_workspaceId_idx" ON "item_option_value"("workspaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "item_option_value_optionId_name_key" ON "item_option_value"("optionId", "name");
CREATE INDEX IF NOT EXISTS "variant_option_value_workspaceId_idx" ON "variant_option_value"("workspaceId");
CREATE INDEX IF NOT EXISTS "variant_option_value_optionValueId_idx" ON "variant_option_value"("optionValueId");

INSERT INTO "item_option" ("id", "itemId", "name", "position", "workspaceId")
SELECT gen_random_uuid()::text, i."id", 'Variação', 0, i."workspaceId"
FROM "item" i
WHERE EXISTS (SELECT 1 FROM "variant" v WHERE v."itemId" = i."id")
  AND NOT EXISTS (SELECT 1 FROM "item_option" o WHERE o."itemId" = i."id");

INSERT INTO "item_option_value" ("id", "optionId", "name", "position", "workspaceId")
SELECT gen_random_uuid()::text, o."id", v."name",
       (ROW_NUMBER() OVER (PARTITION BY o."id" ORDER BY v."name") - 1)::int,
       v."workspaceId"
FROM "variant" v
JOIN "item_option" o ON o."itemId" = v."itemId" AND o."name" = 'Variação'
WHERE NOT EXISTS (SELECT 1 FROM "variant_option_value" vov WHERE vov."variantId" = v."id")
ON CONFLICT ("optionId", "name") DO NOTHING;

INSERT INTO "variant_option_value" ("variantId", "optionValueId", "workspaceId")
SELECT v."id", ov."id", v."workspaceId"
FROM "variant" v
JOIN "item_option" o ON o."itemId" = v."itemId" AND o."name" = 'Variação'
JOIN "item_option_value" ov ON ov."optionId" = o."id" AND ov."name" = v."name"
WHERE NOT EXISTS (SELECT 1 FROM "variant_option_value" vov WHERE vov."variantId" = v."id")
ON CONFLICT DO NOTHING;

COMMIT;
