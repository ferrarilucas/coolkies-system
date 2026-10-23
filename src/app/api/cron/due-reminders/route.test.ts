import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const calls = vi.hoisted(() => ({ reminders: 0, failed: 0, sender: true }));

vi.mock("@/server/notifications/web-push", () => ({
  createWebPushSender: () => (calls.sender ? async () => "sent" : null),
}));

vi.mock("@/server/tenant/push", () => ({
  sendDueTodayReminders: async () => {
    calls.reminders += 1;
    return { workspaces: 2, sent: 3, removed: 1, failed: calls.failed };
  },
}));

const { GET } = await import("./route");

function request(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost:3000/api/cron/due-reminders", { headers }) as unknown as NextRequest;
}

describe("GET /api/cron/due-reminders", () => {
  beforeEach(() => {
    calls.reminders = 0;
    calls.failed = 0;
    calls.sender = true;
    process.env.CRON_SECRET = "s3gredo";
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("sem o segredo responde 401 e não envia nada", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(calls.reminders).toBe(0);
  });

  it("sem chaves VAPID responde 500 e não envia nada", async () => {
    calls.sender = false;
    const res = await GET(request("Bearer s3gredo"));
    expect(res.status).toBe(500);
    expect(calls.reminders).toBe(0);
  });

  it("com o segredo envia os avisos e devolve o resumo", async () => {
    const res = await GET(request("Bearer s3gredo"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspaces: 2, sent: 3, removed: 1, failed: 0 });
  });

  it("responde 500 quando algum envio falha", async () => {
    calls.failed = 1;
    const res = await GET(request("Bearer s3gredo"));
    expect(res.status).toBe(500);
  });
});
