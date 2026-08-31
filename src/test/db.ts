import { PrismaClient } from "@prisma/client";

export const testDb = new PrismaClient();

const TABLES = [
  "member",
  "invitation",
  "workspace",
  "user",
  "processed_webhook_event",
  "stock_movement",
  "production_filling",
  "production_batch",
  "shopping_list_item",
  "recipe_ingredient",
  "ingredient_purchase",
  "sale_item",
  "sale",
  "price_history",
  "price_list_item",
  "flavor",
  "product",
  "recipe",
  "ingredient",
  "market",
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
