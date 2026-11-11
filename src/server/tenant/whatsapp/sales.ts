import { createHash, randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { parsePaymentChoice, planPayment } from "@/lib/installments";
import { normalizeName } from "@/lib/text";
import { writeInstallments } from "@/server/sales/installments";
import { scopedDb } from "../extension";
import { matchNames, normalizeSearch } from "./matching";
import type { SaleInput } from "./sale-input";

const timeZone = "America/Sao_Paulo";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const done = (text: string) => ({ status: "done" as const, text });
const expired = "Esse rascunho já foi resolvido ou expirou. Se precisar, manda a venda de novo.";

type NewCustomer = { name: string; sector?: string; phone?: string; email?: string; notes?: string };
type State = {
  sale: SaleInput;
  customerId?: string;
  newCustomer?: NewCustomer;
  lines: Record<number, string>;
  prompt?: { kind: "customer" | "item" | "date"; options: string[]; line?: number };
};

type CatalogLine = {
  key: string;
  itemId: string;
  product: string;
  variantId: string | null;
  variant: string | null;
  price: number | null;
};

async function catalog(workspaceId: string) {
  const items = await scopedDb(workspaceId).item.findMany({
    where: { active: true, sellable: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: {
      variants: {
        where: { active: true, workspaceId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        include: { priceListItems: { where: { active: true, workspaceId }, orderBy: { updatedAt: "desc" }, take: 1 } },
      },
      priceListItems: {
        where: { active: true, variantId: null, workspaceId },
        orderBy: { updatedAt: "desc" }, take: 1,
      },
    },
  });
  return items.flatMap<CatalogLine>((item) => {
    const basePrice = item.priceListItems[0]?.priceCents ?? null;
    return item.variants.length ? item.variants.map((variant) => ({
      key: variant.id, itemId: item.id, product: item.name, variantId: variant.id,
      variant: variant.name, price: variant.priceListItems[0]?.priceCents ?? basePrice,
    })) : [{ key: item.id, itemId: item.id, product: item.name, variantId: null, variant: null, price: basePrice }];
  });
}

function lineName(line: CatalogLine) {
  return line.variant ? `${line.product} — ${line.variant}` : line.product;
}

function dateOnly(text: string, now: Date) {
  const normalized = normalizeSearch(text);
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  if (normalized === "hoje") return today;
  if (normalized === "amanha") {
    return formatInTimeZone(addDays(now, 1), timeZone, "yyyy-MM-dd");
  }
  const short = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(normalized);
  const iso = short
    ? `${short[3] ?? today.slice(0, 4)}-${short[2].padStart(2, "0")}-${short[1].padStart(2, "0")}`
    : normalized;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const parsed = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function parseNewCustomer(text: string, fallback: string) {
  const [first, ...fields] = text.split(/[;\n]/).map((part) => part.trim());
  const customer: NewCustomer = { name: normalizeName(first.replace(/^nov[oa](?:\s+cliente)?\b\s*/i, "") || fallback) };
  const notes: string[] = [];
  for (const field of fields) {
    if (!field) continue;
    const [label, ...values] = field.split(":");
    const value = values.join(":").trim();
    switch (normalizeSearch(label)) {
      case "nome": if (value) customer.name = normalizeName(value); break;
      case "setor": case "complemento": customer.sector = value; break;
      case "telefone": case "celular": customer.phone = value; break;
      case "email": case "e-mail": customer.email = value; break;
      case "obs": case "observacao": case "observacoes": notes.push(value); break;
      default: notes.push(field);
    }
  }
  if (notes.length) customer.notes = notes.join("\n");
  return customer;
}

export async function hasSaleDraft(userId: string, workspaceId: string, now: Date) {
  return Boolean(await db.whatsAppSaleDraft.findFirst({
    where: { userId, workspaceId, expiresAt: { gt: now } },
    select: { revision: true },
  }));
}

export async function handleSale(
  userId: string,
  workspaceId: string,
  input: { sale: SaleInput; messageId: string } | { text: string; messageId: string },
  now: Date,
) {
  const key = { userId, workspaceId };
  const existing = await db.whatsAppSaleDraft.findUnique({ where: { userId_workspaceId: key } });
  const active = existing && existing.expiresAt > now ? existing : null;
  const receiptId = "cipri.whatsapp.sale." + createHash("sha256").update(JSON.stringify([userId, input.messageId])).digest("hex");
  const state: State | null = "sale" in input
    ? { sale: input.sale, lines: {} }
    : active ? active.state as State : null;
  if (!state) return done(expired);

  const guard = { ...key, revision: existing?.revision };
  const claim = async (tx: Prisma.TransactionClient) => {
    const receipt = await tx.processedWebhookEvent.createMany({
      data: { id: receiptId, event: "cipri.whatsapp.sale" }, skipDuplicates: true,
    });
    return receipt.count > 0;
  };
  const save = async (text: string) => {
    const saved = await db.$transaction(async (tx) => {
      if (!await claim(tx)) return false;
      const data = { state: JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue, revision: randomUUID(), expiresAt: new Date(now.getTime() + 30 * 60_000) };
      const result = existing
        ? await tx.whatsAppSaleDraft.updateMany({ where: guard, data })
        : await tx.whatsAppSaleDraft.createMany({ data: { ...key, ...data }, skipDuplicates: true });
      return Boolean(result.count);
    });
    return done(saved ? text : expired);
  };

  if ("text" in input) {
    const text = input.text.trim();
    if (/^cancelar(?: venda)?$/i.test(text)) {
      const removed = await db.whatsAppSaleDraft.deleteMany({ where: guard });
      return done(removed.count ? "Tudo bem, descartei o rascunho da venda." : expired);
    }
    const choice = /^\d{1,3}$/.test(text) ? Number(text) - 1 : -1;
    const selected = state.prompt?.options[choice];
    if (state.prompt?.kind === "customer") {
      if (/^nov[oa]\b/i.test(text)) state.newCustomer = parseNewCustomer(text, state.sale.customer);
      else if (selected) state.customerId = selected;
      else if (choice === -1) state.sale.customer = text.slice(0, 120);
    } else if (state.prompt?.kind === "item" && state.prompt.line !== undefined) {
      if (selected) state.lines[state.prompt.line] = selected;
      else if (choice === -1) state.sale.items[state.prompt.line].description = text.slice(0, 150);
    } else if (state.prompt?.kind === "date") {
      state.sale.pending = true;
      state.sale.dueDate = dateOnly(text, now) ?? undefined;
    }
  }

  if (state.newCustomer?.email && !z.string().email().safeParse(state.newCustomer.email).success) {
    delete state.newCustomer;
    state.prompt = { kind: "customer", options: [] };
    return save("Esse e-mail parece incompleto. Pode reenviar os dados começando por “novo”, com o e-mail correto ou sem ele?");
  }

  const workspaceDb = scopedDb(workspaceId);
  if (state.customerId && !await workspaceDb.customer.findFirst({ where: { id: state.customerId }, select: { id: true } })) {
    delete state.customerId;
  }
  if (!state.customerId && !state.newCustomer) {
    const customers = await workspaceDb.customer.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, sector: true },
    });
    const candidates = matchNames(state.sale.customer, customers, (customer) => customer.name);
    if (candidates.length === 1 && normalizeSearch(candidates[0].name).includes(normalizeSearch(state.sale.customer))) {
      state.customerId = candidates[0].id;
    } else {
      const options = candidates.slice(0, 10);
      state.prompt = { kind: "customer", options: options.map(({ id }) => id) };
      const choices = options.map((customer, index) => `${index + 1}. ${customer.name} — ${customer.sector || "sem setor"}`);
      return save([
        options.length ? `Qual cliente você quis dizer com “${state.sale.customer}”?` : `Não achei “${state.sale.customer}” no cadastro.`,
        ...choices,
        "Responda com o número ou o nome completo. Para cadastrar, mande: novo Nome Completo; setor: Setor; telefone: ...; e-mail: ...; observações: ...",
      ].join("\n"));
    }
  }

  const products = await catalog(workspaceId);
  const lines: (CatalogLine & { price: number; quantity: number })[] = [];
  for (const [index, requested] of state.sale.items.entries()) {
    const pinned = products.find(({ key }) => key === state.lines[index]);
    const matches = pinned ? [pinned] : matchNames(requested.description, products, lineName);
    const line = matches.length === 1 ? matches[0] : null;
    if (line?.price != null) {
      state.lines[index] = line.key;
      lines.push({ ...line, price: line.price, quantity: requested.quantity });
      continue;
    }
    const options = matches.filter(({ price }) => price !== null).slice(0, 10);
    state.prompt = { kind: "item", line: index, options: options.map(({ key }) => key) };
    return save([
      options.length
        ? `Qual opção você quis dizer com “${requested.description}”?`
        : `Não encontrei “${requested.description}” com preço de venda no catálogo. Me manda o nome e a variação como aparecem no app.`,
      ...options.map((option, n) => `${n + 1}. ${lineName(option)}`),
      ...(options.length ? ["Responda com o número da opção ou digite o nome e a variação."] : []),
    ].join("\n"));
  }

  const count = state.sale.installments ?? 1;
  const pending = count > 1 || state.sale.pending || Boolean(state.sale.dueDate);
  const due = state.sale.dueDate && dateOnly(state.sale.dueDate, now);
  if (pending && !due) {
    state.sale.pending = true;
    state.prompt = { kind: "date", options: [] };
    return save(count > 1
      ? "Qual é a data de vencimento da primeira parcela? Pode mandar no formato DD/MM/AAAA."
      : "Qual é a data prevista para o pagamento? Pode mandar no formato DD/MM/AAAA.");
  }
  const totalCents = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  if (totalCents < 0 || totalCents > 2_147_483_647) return done("O total da venda está fora do limite do Cipri.");
  const payment = parsePaymentChoice({
    mode: count > 1 ? "INSTALLMENTS" : "CASH", status: pending ? "PENDING" : "PAID",
    count, preset: "", dueDate: due ? fromZonedTime(`${due}T12:00:00`, timeZone) : null,
  }, now);
  if ("error" in payment) return done(payment.error);
  const plan = planPayment(payment, totalCents, [], now);
  if (!plan.ok) return done(plan.error);

  try {
    const customerName = await db.$transaction(async (tx) => {
      if (!await claim(tx)) return null;
      // Consume only the draft this message actually resolved.
      if (existing && !(await tx.whatsAppSaleDraft.deleteMany({ where: guard })).count) return null;
      const customer = state.newCustomer
        ? await tx.customer.create({ data: { ...state.newCustomer, workspaceId }, select: { id: true, name: true } })
        : await tx.customer.findFirst({ where: { id: state.customerId, workspaceId }, select: { id: true, name: true } });
      if (!customer) return null;
      const sale = await tx.sale.create({
        data: {
          workspaceId, userId, customerId: customer.id, customerName: customer.name, soldAt: now, totalCents,
          items: { create: lines.map((line) => ({
            workspaceId, itemId: line.itemId, variantId: line.variantId, quantity: line.quantity,
            productNameSnapshot: line.product, variantNameSnapshot: line.variant, unitPriceSnapshot: line.price,
          })) },
        },
      });
      await tx.stockMovement.createMany({
        data: lines.map((line) => ({
          workspaceId, saleId: sale.id, type: "SALE", itemId: line.itemId, variantId: line.variantId, quantity: -line.quantity,
        })),
      });
      await writeInstallments(tx, sale.id, workspaceId, plan.installments);
      return customer.name;
    });
    if (!customerName) return done(expired);
    const dueLabel = due ? due.split("-").reverse().join("/") : null;
    const terms = count > 1 ? `${count} parcelas, primeira em ${dueLabel}`
      : dueLabel ? `à vista, a receber em ${dueLabel}` : "à vista, já paga";
    return done([`Venda registrada para ${customerName}!`, ...lines.map((line) => `${line.quantity}× ${lineName(line)}`),
      `Total: ${money.format(totalCents / 100)} · ${terms}.`].join("\n"));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && state.newCustomer?.email) {
      delete state.newCustomer;
      state.prompt = { kind: "customer", options: [] };
      return save("Já existe um cliente com esse e-mail. Me manda o nome cadastrado ou os dados corrigidos começando por “novo”.");
    }
    throw error;
  }
}
