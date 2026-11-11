import { createHash, randomBytes } from "node:crypto";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { WhatsAppRequest } from "@/app/api/v1/internal/whatsapp/route";
import { db } from "@/lib/db";
import { hasAcceptedCurrentTerms } from "@/server/tenant/account";
import { canWriteInWorkspace } from "@/server/tenant/subscription";
import { hashLinkToken } from "./link";

const APP_TIME_ZONE = "America/Sao_Paulo";
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (cents: number) => currency.format(cents / 100);
const done = (text?: string) => ({ status: "done" as const, text });
const choiceExpired = "Envie novamente a pergunta com o nome do cliente para que eu possa conferir.";
const appUrl = (path: string) => new URL(path, process.env.CIPRI_URL ?? "https://cipri.com.br").toString();
const plans = () => appUrl("/workspaces/plan");

async function dailyNotice(phone: string, messageId: string, linkPhone: boolean, now: Date) {
  const day = formatInTimeZone(now, APP_TIME_ZONE, "yyyy-MM-dd");
  const token = linkPhone ? randomBytes(32).toString("base64url") : null;
  const tokenHash = token ? hashLinkToken(token) : null;
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // A primeira entrega do dia ganha a reserva mesmo com webhooks concorrentes.
  const claimed = await db.$transaction(async (tx) => {
    const updated = await tx.whatsAppNotice.updateMany({
      where: { phone, day: { lt: day } },
      data: { day, tokenHash, expiresAt, consumedAt: null },
    });
    const inserted = updated.count || (await tx.whatsAppNotice.createMany({
      data: { phone, day, tokenHash, expiresAt },
      skipDuplicates: true,
    })).count;
    if (!inserted) return false;
    // Uma repetição do webhook após o vínculo não vira uma nova consulta.
    await tx.processedWebhookEvent.createMany({
      data: { id: receiptId(phone, messageId), event: "cipri.whatsapp" },
      skipDuplicates: true,
    });
    return true;
  });
  if (!claimed) return done();
  const intro = "Este canal é exclusivo para assinantes do Cipri.";
  if (!token) return done(`${intro} Veja os planos em ${plans()}`);
  const link = new URL(appUrl("/vincular-whatsapp"));
  link.searchParams.set("token", token);
  return done(`${intro} Entre na sua conta para vincular este WhatsApp: ${link}\nPara assinar, acesse ${plans()}`);
}

function receiptId(phone: string, messageId: string) {
  const digest = createHash("sha256").update(`${phone}:${messageId}`).digest("hex");
  return `cipri.whatsapp.${digest}`;
}

async function customerBalance(workspaceId: string, id: string) {
  const customer = await db.customer.findFirst({ where: { id, workspaceId }, select: { name: true } });
  if (!customer) return done(choiceExpired);
  const total = await db.saleInstallment.aggregate({
    where: { workspaceId, paidAt: null, sale: { workspaceId, customerId: id } },
    _sum: { amountCents: true },
  });
  return done(`${customer.name} tem ${money(total._sum.amountCents ?? 0)} em aberto.`);
}

async function findCustomers(workspaceId: string, phone: string, name: string, now: Date) {
  const term = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (!term.trim()) return done(choiceExpired);
  const customers = await db.$queryRaw<{ id: string; name: string; phone: string | null; sector: string | null }[]>`
    SELECT id, name, phone, sector
    FROM "customer"
    WHERE "workspaceId" = ${workspaceId}
      AND strpos(translate(lower(name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), ${term}) > 0
    ORDER BY name, id
    LIMIT 7
  `;
  if (!customers.length) return done(`Não encontrei nenhum cliente com o nome “${name}”.`);
  if (customers.length === 1) return customerBalance(workspaceId, customers[0].id);
  if (customers.length > 6) return done("Encontrei vários clientes. Envie a pergunta com um nome mais completo.");

  const choice = {
    workspaceId,
    customerIds: customers.map((customer) => customer.id),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
  };
  await db.whatsAppCustomerChoice.upsert({ where: { phone }, create: { phone, ...choice }, update: choice });
  const options = customers.map((customer, index) => {
    const final = customer.phone?.replace(/\D/g, "").slice(-4);
    const details = [customer.sector, final ? `telefone final ${final}` : null].filter(Boolean);
    return `${index + 1}. ${customer.name}${details.length ? ` (${details.join(", ")})` : ""}`;
  });
  return done(["Qual cliente você quis dizer? Responda com o número da opção.", ...options].join("\n"));
}

async function confirmCustomer(workspaceId: string, phone: string, option: number, now: Date) {
  const pending = await db.whatsAppCustomerChoice.findUnique({ where: { phone } });
  if (!pending || pending.workspaceId !== workspaceId || pending.expiresAt <= now) return done(choiceExpired);
  const id = pending.customerIds[option - 1];
  if (!id) return done(`Responda com um número de 1 a ${pending.customerIds.length}.`);
  const consumed = await db.whatsAppCustomerChoice.deleteMany({
    where: { phone, workspaceId, expiresAt: pending.expiresAt, customerIds: { equals: pending.customerIds } },
  });
  return consumed.count ? customerBalance(workspaceId, id) : done(choiceExpired);
}

async function monthReceivables(workspaceId: string, now: Date) {
  const yearMonth = formatInTimeZone(now, APP_TIME_ZONE, "yyyy-MM");
  const [year, month] = yearMonth.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  const range = {
    gte: fromZonedTime(`${yearMonth}-01T00:00:00`, APP_TIME_ZONE),
    lt: fromZonedTime(`${nextMonth}-01T00:00:00`, APP_TIME_ZONE),
  };
  const total = await db.saleInstallment.aggregate({
    where: {
      workspaceId,
      paidAt: null,
      sale: { workspaceId },
      dueDate: range,
    },
    _sum: { amountCents: true },
    _count: true,
  });
  return done(`Você tem ${money(total._sum.amountCents ?? 0)} em aberto com vencimento neste mês (${total._count} pendências).`);
}

export async function handleWhatsAppRequest(input: WhatsAppRequest) {
  const now = new Date();
  const { phone } = input;
  const account = await db.user.findUnique({
    where: { whatsappPhone: phone },
    select: {
      id: true,
      members: { take: 2, select: { workspaceId: true } },
    },
  });

  if (!account) return input.action === "access" ? dailyNotice(phone, input.messageId, true, now) : done();
  if (!(await hasAcceptedCurrentTerms(account.id))) {
    return done(input.action === "access" ? `Entre no Cipri e aceite os termos para continuar: ${appUrl("/accept-terms")}` : undefined);
  }
  if (account.members.length !== 1) {
    const message = account.members.length
      ? "Sua conta tem mais de um espaço. Por enquanto, consulte seus valores pelo app do Cipri."
      : "Crie um espaço no Cipri antes de fazer consultas pelo WhatsApp.";
    return done(input.action === "access" ? message : undefined);
  }

  const { workspaceId } = account.members[0];
  if (!(await canWriteInWorkspace(workspaceId))) {
    return input.action === "access" ? dailyNotice(phone, input.messageId, false, now) : done();
  }
  switch (input.action) {
    case "access": {
      const receipt = await db.processedWebhookEvent.createMany({
        data: { id: receiptId(phone, input.messageId), event: "cipri.whatsapp" },
        skipDuplicates: true,
      });
      return receipt.count ? { status: "allowed" as const } : done();
    }
    case "confirm":
      return confirmCustomer(workspaceId, phone, input.option, now);
    case "customer_balance":
      return findCustomers(workspaceId, phone, input.name, now);
    case "month_receivables":
      return monthReceivables(workspaceId, now);
  }
}
