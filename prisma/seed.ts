import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const workspace = await db.workspace.upsert({
    where: { slug: "dev-seed" },
    update: {},
    create: { name: "Dev Seed", slug: "dev-seed" },
  });

  // Pré-cadastro (allowlist): só estes e-mails podem acessar o app.
  // O primeiro login aplica o role definido aqui.
  await db.allowedEmail.upsert({
    where: { email: "ferrari.lucasr@gmail.com" },
    update: { role: "ADMIN" },
    create: {
      email: "ferrari.lucasr@gmail.com",
      role: "ADMIN",
      note: "Owner",
    },
  });

  // Produto base
  const cookie = await db.product.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: "Cookie" } },
    update: {},
    create: { name: "Cookie", workspaceId: workspace.id },
  });

  // Sabores
  const flavors = ["Chocolate", "Red Velvet", "Tradicional"];
  for (const name of flavors) {
    const flavor = await db.flavor.upsert({
      where: { productId_name: { productId: cookie.id, name } },
      update: {},
      create: { name, productId: cookie.id, workspaceId: workspace.id },
    });
    // Preço atual exemplo: R$ 8,00
    await db.priceListItem.upsert({
      where: {
        productId_flavorId: { productId: cookie.id, flavorId: flavor.id },
      },
      update: {},
      create: {
        productId: cookie.id,
        flavorId: flavor.id,
        priceCents: 800,
        workspaceId: workspace.id,
      },
    });
  }

  // Ingredientes exemplo
  const ingredients: Array<[string, "G" | "ML" | "UN"]> = [
    ["Açúcar", "G"],
    ["Farinha de trigo", "G"],
    ["Manteiga", "G"],
    ["Chocolate", "G"],
    ["Ovo", "UN"],
  ];
  for (const [name, baseUnit] of ingredients) {
    await db.ingredient.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name } },
      update: {},
      create: { name, baseUnit, minStock: 0, workspaceId: workspace.id },
    });
  }

  // Mercado exemplo
  await db.market.upsert({
    where: {
      workspaceId_name: { workspaceId: workspace.id, name: "Mercado Central" },
    },
    update: {},
    create: { name: "Mercado Central", workspaceId: workspace.id },
  });

  console.log("Seed concluído ✔");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
