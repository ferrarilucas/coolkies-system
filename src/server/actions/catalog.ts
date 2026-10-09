"use server";

import { revalidatePath } from "next/cache";
import { assertCanWrite, getScopedDb } from "@/server/tenant/context";
import type { Prisma } from "@prisma/client";
import { normalizeName } from "@/lib/text";
import {
  combinationName,
  resolveCombination,
  validateOptions,
  type OptionInput,
} from "@/lib/variant-options";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

// ─── Ativar / desativar ─────────────────────────────

export async function toggleItemActive(id: string, active: boolean): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  await db.item.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function toggleVariantActive(id: string, active: boolean): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  await db.variant.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}

export async function togglePriceActive(id: string, active: boolean): Promise<ActionResult> {
  const { db } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();
  await db.priceListItem.update({ where: { id }, data: { active } });
  revalidatePath("/admin/catalog");
  return { ok: true };
}

export type ItemCombinationInput = {
  id: string | null;
  valueKeys: string[];
  priceCents: number | null;
  recipeId: string | null;
  active: boolean;
};

export type SaveItemInput = {
  name: string;
  genericPriceCents: number | null;
  options: OptionInput[];
  combinations: ItemCombinationInput[];
  removedVariantIds: string[];
};

type Tx = Prisma.TransactionClient;
type ResolvedCombination = ItemCombinationInput & { name: string };

async function applyPrice(
  db: Tx,
  workspaceId: string,
  itemId: string,
  variantId: string | null,
  priceCents: number | null,
) {
  const existing = await db.priceListItem.findFirst({
    where: { itemId, variantId, workspaceId },
  });

  if (priceCents == null || priceCents <= 0) {
    if (existing) await db.priceListItem.delete({ where: { id: existing.id } });
    return;
  }

  if (!existing) {
    await db.priceListItem.create({
      data: { itemId, variantId, priceCents, workspaceId },
    });
    return;
  }

  if (existing.priceCents !== priceCents) {
    await db.priceHistory.create({
      data: { priceListItemId: existing.id, priceCents: existing.priceCents, workspaceId },
    });
    await db.priceListItem.update({
      where: { id: existing.id },
      data: { priceCents, active: true },
    });
  }
}

async function hasHistory(db: Tx, variantId: string): Promise<boolean> {
  const counts = await Promise.all([
    db.saleItem.count({ where: { variantId } }),
    db.productionBatch.count({ where: { variantId } }),
    db.productionVariantLine.count({ where: { variantId } }),
    db.stockMovement.count({ where: { variantId } }),
    db.purchaseItem.count({ where: { variantId } }),
  ]);
  return counts.some((c) => c > 0);
}

function resolveCombinations(
  options: OptionInput[],
  combinations: ItemCombinationInput[],
): { ok: true; combinations: ResolvedCombination[] } | { ok: false; error: string } {
  if (options.length === 0 && combinations.length > 0) {
    return { ok: false, error: "Adicione um tipo de variação antes de marcar combinações." };
  }
  if (options.length > 0 && combinations.length === 0) {
    return { ok: false, error: "Marque pelo menos uma opção para vender ou remova as variações." };
  }

  const seen = new Set<string>();
  const resolved: ResolvedCombination[] = [];
  for (const combination of combinations) {
    const result = resolveCombination(options, combination.valueKeys);
    if (!result.ok) return result;
    const name = combinationName(options, result.valueKeys);
    const key = result.valueKeys.join("|");
    if (seen.has(key)) return { ok: false, error: `A combinação "${name}" está repetida.` };
    seen.add(key);
    resolved.push({ ...combination, valueKeys: result.valueKeys, name });
  }
  return { ok: true, combinations: resolved };
}

function priceError(
  options: OptionInput[],
  combinations: ResolvedCombination[],
  genericPriceCents: number | null,
): string | null {
  const hasGeneric = (genericPriceCents ?? 0) > 0;
  if (options.length === 0) return hasGeneric ? null : "Defina um preço de venda para o produto.";
  const missing = combinations.find((c) => c.active && !((c.priceCents ?? 0) > 0) && !hasGeneric);
  return missing ? `Defina um preço para "${missing.name}" ou um preço padrão para o produto.` : null;
}

export async function saveItem(
  itemId: string | null,
  input: SaveItemInput,
): Promise<ActionResult<{ id: string; deactivated: string[] }>> {
  const { db, workspaceId } = await getScopedDb("OWNER", "ADMIN");
  await assertCanWrite();

  const name = normalizeName(input.name);
  if (!name) return { ok: false, error: "Nome do produto é obrigatório." };

  const validated = validateOptions(input.options);
  if (!validated.ok) return validated;
  const options = validated.options;

  const resolved = resolveCombinations(options, input.combinations);
  if (!resolved.ok) return resolved;
  const combinations = resolved.combinations;

  const missingPrice = priceError(options, combinations, input.genericPriceCents);
  if (missingPrice) return { ok: false, error: missingPrice };

  const duplicateName = await db.item.findFirst({
    where: { name, ...(itemId ? { id: { not: itemId } } : {}) },
    select: { id: true },
  });
  if (duplicateName) return { ok: false, error: "Já existe um produto com esse nome." };

  if (itemId) {
    const owned = await ownsReferences(db, itemId, options, combinations, input.removedVariantIds);
    if (!owned) return { ok: false, error: "Produto não encontrado." };
  }

  const result = await db.$transaction(async (tx) => {
    const item = itemId
      ? await tx.item.update({ where: { id: itemId }, data: { name } })
      : await tx.item.create({ data: { name, sellable: true, workspaceId } });

    const deactivated: string[] = [];
    for (const variantId of input.removedVariantIds) {
      if (await hasHistory(tx, variantId)) {
        const variant = await tx.variant.update({ where: { id: variantId }, data: { active: false } });
        deactivated.push(variant.name);
      } else {
        await tx.priceListItem.deleteMany({ where: { variantId, workspaceId } });
        await tx.variant.delete({ where: { id: variantId } });
      }
    }

    const valueIdByKey = await syncOptions(tx, workspaceId, item.id, options);

    const keptVariantIds = new Set<string>();
    for (const combination of combinations) {
      const variantId = await upsertCombination(tx, workspaceId, item.id, combination, valueIdByKey);
      keptVariantIds.add(variantId);
      await applyPrice(tx, workspaceId, item.id, variantId, combination.priceCents);
    }

    await renameOtherVariants(tx, item.id, keptVariantIds);
    await applyPrice(tx, workspaceId, item.id, null, input.genericPriceCents);

    return { id: item.id, deactivated };
  });

  revalidatePath("/admin/catalog");
  revalidatePath("/sales/new");
  return { ok: true, data: result };
}

async function ownsReferences(
  db: Awaited<ReturnType<typeof getScopedDb>>["db"],
  itemId: string,
  options: OptionInput[],
  combinations: ResolvedCombination[],
  removedVariantIds: string[],
): Promise<boolean> {
  const item = await db.item.findUnique({
    where: { id: itemId },
    include: { variants: { select: { id: true } }, options: { include: { values: { select: { id: true } } } } },
  });
  if (!item) return false;

  const variantIds = new Set(item.variants.map((v) => v.id));
  const optionValues = new Map(item.options.map((o) => [o.id, new Set(o.values.map((v) => v.id))]));

  for (const option of options) {
    if (!option.id) {
      if (option.values.some((v) => v.id)) return false;
      continue;
    }
    const values = optionValues.get(option.id);
    if (!values) return false;
    if (option.values.some((v) => v.id && !values.has(v.id))) return false;
  }
  if (combinations.some((c) => c.id && !variantIds.has(c.id))) return false;
  return removedVariantIds.every((id) => variantIds.has(id));
}

async function syncOptions(
  tx: Tx,
  workspaceId: string,
  itemId: string,
  options: OptionInput[],
): Promise<Map<string, string>> {
  const keepOptionIds = options.map((o) => o.id).filter((id): id is string => !!id);
  await tx.itemOption.deleteMany({ where: { itemId, workspaceId, id: { notIn: keepOptionIds } } });

  const valueIdByKey = new Map<string, string>();
  for (const [position, option] of options.entries()) {
    const saved = option.id
      ? await tx.itemOption.update({ where: { id: option.id }, data: { name: option.name, position } })
      : await tx.itemOption.create({ data: { itemId, name: option.name, position, workspaceId } });

    const keepValueIds = option.values.map((v) => v.id).filter((id): id is string => !!id);
    await tx.itemOptionValue.deleteMany({
      where: { optionId: saved.id, workspaceId, id: { notIn: keepValueIds } },
    });

    for (const [valuePosition, value] of option.values.entries()) {
      const savedValue = value.id
        ? await tx.itemOptionValue.update({
            where: { id: value.id },
            data: { name: value.name, position: valuePosition },
          })
        : await tx.itemOptionValue.create({
            data: { optionId: saved.id, name: value.name, position: valuePosition, workspaceId },
          });
      valueIdByKey.set(value.key, savedValue.id);
    }
  }
  return valueIdByKey;
}

async function upsertCombination(
  tx: Tx,
  workspaceId: string,
  itemId: string,
  combination: ResolvedCombination,
  valueIdByKey: Map<string, string>,
): Promise<string> {
  const data = { name: combination.name, recipeId: combination.recipeId, active: combination.active };
  const sameName = combination.id
    ? null
    : await tx.variant.findFirst({ where: { itemId, workspaceId, name: combination.name } });
  const targetId = combination.id ?? sameName?.id ?? null;

  const variant = targetId
    ? await tx.variant.update({ where: { id: targetId }, data })
    : await tx.variant.create({ data: { ...data, itemId, workspaceId } });

  await tx.variantOptionValue.deleteMany({ where: { variantId: variant.id, workspaceId } });
  await tx.variantOptionValue.createMany({
    data: combination.valueKeys.map((key) => ({
      variantId: variant.id,
      optionValueId: valueIdByKey.get(key)!,
      workspaceId,
    })),
  });
  return variant.id;
}

async function renameOtherVariants(tx: Tx, itemId: string, keptVariantIds: Set<string>) {
  const options = await tx.itemOption.findMany({ where: { itemId }, select: { id: true } });
  if (options.length === 0) return;

  const variants = await tx.variant.findMany({
    where: { itemId, id: { notIn: [...keptVariantIds] } },
    include: { optionValues: { include: { optionValue: { include: { option: true } } } } },
  });
  for (const variant of variants) {
    if (variant.optionValues.length !== options.length) continue;
    const name = variant.optionValues
      .map((link) => link.optionValue)
      .sort((a, b) => a.option.position - b.option.position)
      .map((value) => value.name)
      .join(" / ");
    if (name !== variant.name) await tx.variant.update({ where: { id: variant.id }, data: { name } });
  }
}
