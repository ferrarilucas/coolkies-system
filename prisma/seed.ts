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

  const cookie = await db.item.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: "Cookie" } },
    update: {},
    create: { name: "Cookie", sellable: true, unit: "UN", workspaceId: workspace.id },
  });

  const variants = ["Chocolate", "Red Velvet", "Tradicional"];
  for (const name of variants) {
    const variant = await db.variant.upsert({
      where: { itemId_name: { itemId: cookie.id, name } },
      update: {},
      create: { name, itemId: cookie.id, workspaceId: workspace.id },
    });
    await db.priceListItem.upsert({
      where: { itemId_variantId: { itemId: cookie.id, variantId: variant.id } },
      update: {},
      create: { itemId: cookie.id, variantId: variant.id, priceCents: 800, workspaceId: workspace.id },
    });
  }

  const rawItems: Array<[string, "G" | "ML" | "UN"]> = [
    ["Açúcar", "G"],
    ["Farinha de trigo", "G"],
    ["Manteiga", "G"],
    ["Chocolate (insumo)", "G"],
    ["Ovo", "UN"],
  ];
  for (const [name, unit] of rawItems) {
    await db.item.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name } },
      update: {},
      create: { name, unit, productionInput: true, sellable: false, minStock: 0, workspaceId: workspace.id },
    });
  }

  // Mercado exemplo
  await db.supplier.upsert({
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
