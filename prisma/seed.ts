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

  const product = await db.item.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: "Camiseta básica" } },
    update: {},
    create: { name: "Camiseta básica", sellable: true, unit: "UN", workspaceId: workspace.id },
  });

  const variants = ["P", "M", "G"];
  for (const name of variants) {
    const variant = await db.variant.upsert({
      where: { itemId_name: { itemId: product.id, name } },
      update: {},
      create: { name, itemId: product.id, workspaceId: workspace.id },
    });
    await db.priceListItem.upsert({
      where: { itemId_variantId: { itemId: product.id, variantId: variant.id } },
      update: {},
      create: { itemId: product.id, variantId: variant.id, priceCents: 4900, workspaceId: workspace.id },
    });
  }

  const rawItems: Array<[string, "G" | "ML" | "UN"]> = [
    ["Malha de algodão", "G"],
    ["Linha", "ML"],
    ["Etiqueta", "UN"],
    ["Embalagem", "UN"],
  ];
  for (const [name, unit] of rawItems) {
    await db.item.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name } },
      update: {},
      create: { name, unit, productionInput: true, sellable: false, minStock: 0, workspaceId: workspace.id },
    });
  }

  await db.supplier.upsert({
    where: {
      workspaceId_name: { workspaceId: workspace.id, name: "Fornecedor Central" },
    },
    update: {},
    create: { name: "Fornecedor Central", workspaceId: workspace.id },
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
