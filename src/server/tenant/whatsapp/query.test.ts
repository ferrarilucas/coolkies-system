import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleWhatsAppRequest } from "./query";

const { db } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    processedWebhookEvent: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/server/tenant/account", () => ({ hasAcceptedCurrentTerms: async () => true }));
vi.mock("@/server/tenant/subscription", () => ({ canWriteInWorkspace: async () => true }));

vi.mock("./sales", () => ({ hasSaleDraft: async () => false }));

const phone = "5551999892403";
const members = [
  { workspaceId: "a", workspace: { name: "Loja A" } },
  { workspaceId: "b", workspace: { name: "Loja B" } },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T02:59:00Z"));
  db.user.findUnique.mockResolvedValue({ id: "user", members, sessions: [{ activeWorkspaceId: "b" }] });
  db.$transaction.mockImplementation((callback) => callback(db));
  const receipts = new Set<string>();
  db.processedWebhookEvent.createMany.mockImplementation(({ data }) => {
    if (receipts.has(data.id)) return { count: 0 };
    receipts.add(data.id);
    return { count: 1 };
  });
});
afterEach(() => vi.useRealTimers());

describe("workspace do WhatsApp", () => {
  it("anuncia o workspace da sessão uma vez por dia no horário de São Paulo", async () => {
    const access = (messageId: string) => handleWhatsAppRequest({ action: "access", phone, messageId });
    await expect(access("m1")).resolves.toMatchObject({
      status: "allowed", workspaceId: "b", text: expect.stringContaining("Loja B"),
    });
    await expect(access("m2")).resolves.toEqual({ status: "allowed", workspaceId: "b", text: undefined });
    await expect(access("m1")).resolves.toMatchObject({ status: "done", text: undefined });

    vi.setSystemTime(new Date("2026-11-12T03:00:00Z"));
    await expect(access("m3")).resolves.toMatchObject({ text: expect.stringContaining("Loja B") });
  });

  it("orienta a troca no app e usa a nova seleção na próxima consulta", async () => {
    await expect(handleWhatsAppRequest({ action: "access", phone, messageId: "m1", switchWorkspace: true }))
      .resolves.toMatchObject({ status: "done", text: expect.stringContaining("selecione outro espaço no app") });
    db.user.findUnique.mockResolvedValue({ id: "user", members, sessions: [{ activeWorkspaceId: "a" }] });
    await expect(handleWhatsAppRequest({ action: "access", phone, messageId: "m2" }))
      .resolves.toMatchObject({ status: "allowed", workspaceId: "a" });
    await expect(handleWhatsAppRequest({ action: "month_receivables", phone, workspaceId: "b" }))
      .resolves.toMatchObject({ status: "done", text: expect.stringContaining("espaço da conversa mudou") });
  });

  it("usa o primeiro vínculo válido quando a sessão aponta para um espaço indisponível", async () => {
    db.user.findUnique.mockResolvedValue({ id: "user", members, sessions: [{ activeWorkspaceId: "removed" }] });
    await expect(handleWhatsAppRequest({ action: "access", phone, messageId: "m1" }))
      .resolves.toMatchObject({ status: "allowed", workspaceId: "a" });
  });
});
