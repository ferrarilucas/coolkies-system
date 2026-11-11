import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleWhatsAppRequest } from "./query";

const { db } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    processedWebhookEvent: { createMany: vi.fn() },
    whatsAppWorkspaceContext: { upsert: vi.fn(), updateMany: vi.fn() },
    whatsAppCustomerChoice: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/server/tenant/account", () => ({ hasAcceptedCurrentTerms: async () => true }));
vi.mock("@/server/tenant/subscription", () => ({ canWriteInWorkspace: async () => true }));

const phone = "5551999892403";
const menuId = "68d4961f-f1a0-45e5-8ef6-c7bdd99a7397";
const members = [
  { workspaceId: "a", workspace: { name: "Loja A" } },
  { workspaceId: "b", workspace: { name: "Loja B" } },
];
const now = Date.parse("2026-11-11T15:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  db.processedWebhookEvent.createMany.mockResolvedValue({ count: 1 });
});

afterEach(() => vi.useRealTimers());

describe("workspace do WhatsApp", () => {
  it("mostra o menu após expirar ou quando o usuário pede para trocar", async () => {
    for (const switchWorkspace of [false, true]) {
      db.user.findUnique.mockResolvedValue({
        id: "user", members, whatsappWorkspaceContext: {
          workspaceId: "a",
          expiresAt: new Date(Date.now() + (switchWorkspace ? 60_000 : -60_000)),
        },
      });
      await expect(handleWhatsAppRequest({ action: "access", phone, messageId: "m1", switchWorkspace }))
        .resolves.toMatchObject({ status: "done", workspaceMenu: { names: ["Loja A", "Loja B"] } });
    }
  });

  it("registra a escolha por 24 horas e limpa a confirmação de cliente anterior", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "user", members, whatsappWorkspaceContext: {
        menuId, menuWorkspaceIds: ["a", "b"], menuExpiresAt: new Date("2099-01-01"),
      },
    });
    db.$transaction.mockImplementation((callback) => callback(db));
    db.whatsAppWorkspaceContext.updateMany.mockResolvedValue({ count: 1 });
    await expect(handleWhatsAppRequest({ action: "select_workspace", phone, menuId, option: 2 }))
      .resolves.toMatchObject({ text: expect.stringContaining("Loja B") });
    const { expiresAt } = db.whatsAppWorkspaceContext.updateMany.mock.calls[0][0].data;
    expect(expiresAt.getTime()).toBe(now + 86_400_000);
    expect(db.whatsAppCustomerChoice.deleteMany).toHaveBeenCalledWith({ where: { phone } });
  });

  it("rejeita um workspace que deixou de pertencer à conta", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "user", members: [members[0]], whatsappWorkspaceContext: {
        menuId, menuWorkspaceIds: ["a", "b"], menuExpiresAt: new Date("2099-01-01"),
      },
    });
    await expect(handleWhatsAppRequest({ action: "select_workspace", phone, menuId, option: 2 }))
      .resolves.toMatchObject({ text: expect.stringContaining("trocar workspace") });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
