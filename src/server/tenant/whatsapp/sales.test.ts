import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSale } from "./sales";

const { db } = vi.hoisted(() => ({
  db: {
    whatsAppSaleDraft: { findUnique: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    processedWebhookEvent: { createMany: vi.fn() },
    customer: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    item: { findMany: vi.fn() },
    sale: { create: vi.fn() },
    stockMovement: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("../extension", () => ({ scopedDb: () => db }));
vi.mock("@/server/sales/installments", () => ({ writeInstallments: vi.fn() }));

const now = new Date("2026-11-11T20:00:00Z");
const sale = {
  customer: "jenifer",
  items: [
    { description: "cookie branco", quantity: 1 },
    { description: "cookie de nuttelaa", quantity: 2 },
    { description: "trufas de ninho", quantity: 3 },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((callback) => callback(db));
  db.processedWebhookEvent.createMany.mockResolvedValue({ count: 1 });
  db.whatsAppSaleDraft.createMany.mockImplementation(({ data }) => {
    db.whatsAppSaleDraft.findUnique.mockResolvedValue(data);
    return { count: 1 };
  });
  db.whatsAppSaleDraft.updateMany.mockImplementation(({ data }) => {
    db.whatsAppSaleDraft.findUnique.mockResolvedValue(data);
    return { count: 1 };
  });
  db.whatsAppSaleDraft.deleteMany.mockResolvedValue({ count: 1 });
  db.item.findMany.mockResolvedValue([
    { id: "cookie", name: "Cookie", variants: [
      { id: "branco", name: "Chocolate Branco", priceListItems: [{ priceCents: 500 }] },
      { id: "nutella", name: "Nutella", priceListItems: [{ priceCents: 600 }] },
    ], priceListItems: [] },
    { id: "trufa", name: "Trufa", variants: [
      { id: "ninho", name: "Ninho", priceListItems: [{ priceCents: 300 }] },
    ], priceListItems: [] },
  ]);
  db.customer.findMany.mockResolvedValue([{ id: "j", name: "Jenifer Silva", sector: "Compras" }]);
  db.customer.findFirst.mockResolvedValue({ id: "j", name: "Jenifer Silva" });
  db.sale.create.mockResolvedValue({ id: "sale" });
});

describe("vendas pelo WhatsApp", () => {
  it("registra a venda direto com variações, preços do catálogo e data atual", async () => {
    const response = await handleSale("u", "w", { messageId: "m1", sale }, now);
    expect(response.text).toContain("Venda registrada para Jenifer Silva");
    expect(response.text).toContain("à vista, já paga");
    expect(db.sale.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      soldAt: now,
      totalCents: 2600,
      customerId: "j",
      items: { create: [
        expect.objectContaining({ variantId: "branco", quantity: 1 }),
        expect.objectContaining({ variantId: "nutella", quantity: 2 }),
        expect.objectContaining({ variantId: "ninho", quantity: 3 }),
      ] },
    }) }));
  });

  it("lista homônimos com setor e cadastra um novo cliente com os dados informados", async () => {
    db.customer.findMany.mockResolvedValue([
      { id: "j", name: "Jenifer Silva", sector: "Compras" },
      { id: "k", name: "Jenifer Costa", sector: "Financeiro" },
    ]);
    db.customer.create.mockResolvedValue({ id: "novo", name: "Jenifer Lima" });
    const choice = await handleSale("u", "w", { messageId: "m1", sale }, now);
    expect(choice.text).toContain("Jenifer Silva — Compras");
    expect(choice.text).toContain("Jenifer Costa — Financeiro");
    expect(db.sale.create).not.toHaveBeenCalled();
    const result = await handleSale("u", "w", {
      messageId: "m2", text: "novo Jenifer Lima; complemento: RH; telefone: 51999999999; e-mail: jen@example.com; observações: portaria",
    }, now);
    expect(db.customer.create).toHaveBeenCalledWith(expect.objectContaining({ data: {
      name: "Jenifer Lima", sector: "RH", phone: "51999999999", email: "jen@example.com", notes: "portaria", workspaceId: "w",
    } }));
    expect(result.text).toContain("Venda registrada para Jenifer Lima");
  });

  it("aguarda vencimento de venda pendente e rejeita datas impossíveis", async () => {
    const pending = await handleSale("u", "w", { messageId: "m1", sale: { ...sale, pending: true } }, now);
    expect(pending.text).toContain("data prevista");
    const invalid = await handleSale("u", "w", { messageId: "m2", text: "31/02/2027" }, now);
    expect(invalid.text).toContain("data prevista");
    expect(db.sale.create).not.toHaveBeenCalled();
    const result = await handleSale("u", "w", { messageId: "m3", text: "20/11/2026" }, now);
    expect(result.text).toContain("a receber em 20/11/2026");
  });

  it("não repete uma venda quando o identificador da mensagem já foi consumido", async () => {
    db.processedWebhookEvent.createMany.mockResolvedValue({ count: 0 });
    await handleSale("u", "w", { messageId: "m1", sale }, now);
    expect(db.sale.create).not.toHaveBeenCalled();
  });
});
