import { PrismaClient } from "@prisma/client";

export const testDb = new PrismaClient();

const TABLES = [
  "api_rate_limit",
  "rate_limit",
  "mcp_workspace_context",
  "member",
  "invitation",
  "workspace",
  "user",
  "oauth_consent",
  "oauth_access_token",
  "oauth_application",
  "processed_webhook_event",
  "subscription",
  "stock_movement",
  "production_variant_line",
  "production_batch",
  "shopping_list_item",
  "recipe_item",
  "purchase_item",
  "purchase",
  "sale_installment",
  "sale_item",
  "sale",
  "price_history",
  "price_list_item",
  "variant_option_value",
  "item_option_value",
  "item_option",
  "variant",
  "item",
  "recipe",
  "supplier",
  "customer",
];

export async function resetDb() {
  await testDb.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;

export async function createWorkspace(name: string) {
  counter += 1;
  return testDb.workspace.create({
    data: { name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${counter}` },
  });
}

export async function backfillSaleInstallments() {
  await testDb.$executeRawUnsafe(`
    INSERT INTO "sale_installment" ("id", "saleId", "number", "amountCents", "dueDate", "forecastPreset", "paidAt", "workspaceId", "updatedAt")
    SELECT 'inst_' || s."id", s."id", 1, s."totalCents", s."paymentForecastDate", s."forecastPreset",
      CASE WHEN s."status" = 'PAID' THEN COALESCE(s."paidAt", s."soldAt") END, s."workspaceId", CURRENT_TIMESTAMP
    FROM "sale" s
    WHERE NOT EXISTS (SELECT 1 FROM "sale_installment" i WHERE i."saleId" = s."id")
  `);
  await testDb.$executeRawUnsafe(`
    UPDATE "sale_installment" i
    SET "paidAt" = COALESCE(s."paidAt", s."soldAt"), "updatedAt" = CURRENT_TIMESTAMP
    FROM "sale" s
    WHERE i."saleId" = s."id" AND s."installmentCount" = 1 AND s."status" = 'PAID' AND i."paidAt" IS NULL
  `);
  await testDb.$executeRawUnsafe(`
    UPDATE "sale_installment" i
    SET "paidAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    FROM "sale" s
    WHERE i."saleId" = s."id" AND s."installmentCount" = 1 AND s."status" = 'PENDING' AND i."paidAt" IS NOT NULL
  `);
  await testDb.$executeRawUnsafe(`
    UPDATE "sale_installment" i
    SET "amountCents" = s."totalCents", "updatedAt" = CURRENT_TIMESTAMP
    FROM "sale" s
    WHERE i."saleId" = s."id" AND s."installmentCount" = 1 AND i."amountCents" <> s."totalCents"
  `);
  await testDb.$executeRawUnsafe(`
    UPDATE "sale_installment" i
    SET "dueDate" = s."paymentForecastDate", "forecastPreset" = s."forecastPreset", "updatedAt" = CURRENT_TIMESTAMP
    FROM "sale" s
    WHERE i."saleId" = s."id" AND s."installmentCount" = 1 AND s."status" = 'PENDING'
      AND (i."dueDate" IS DISTINCT FROM s."paymentForecastDate" OR i."forecastPreset" IS DISTINCT FROM s."forecastPreset")
  `);
  await testDb.$executeRawUnsafe(`
    UPDATE "sale" SET "openCents" = CASE WHEN "status" = 'PENDING' THEN "totalCents" ELSE 0 END
    WHERE "installmentCount" = 1
  `);
}
