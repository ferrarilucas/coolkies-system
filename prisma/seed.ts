import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
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
    where: { name: "Cookie" },
    update: {},
    create: { name: "Cookie" },
  });

  // Sabores
  const flavors = ["Chocolate", "Red Velvet", "Tradicional"];
  for (const name of flavors) {
    const flavor = await db.flavor.upsert({
      where: { productId_name: { productId: cookie.id, name } },
      update: {},
      create: { name, productId: cookie.id },
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
      where: { name },
      update: {},
      create: { name, baseUnit, minStock: 0 },
    });
  }

  // Mercado exemplo
  await db.market.upsert({
    where: { name: "Mercado Central" },
    update: {},
    create: { name: "Mercado Central" },
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
