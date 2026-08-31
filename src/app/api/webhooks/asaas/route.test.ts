import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { POST } from "./route";

const URL = "http://localhost/api/webhooks/asaas";
const TOKEN = "token-de-teste";

async function subscriptionFor(email: string, asaasId: string) {
  const user = await testDb.user.create({
    data: { id: `u-${asaasId}`, name: "Dono", email },
  });
  return testDb.subscription.create({
    data: {
      userId: user.id,
      plan: "solo",
      source: "ASAAS",
      status: "TRIALING",
      asaasSubscriptionId: asaasId,
    },
  });
}

function requestWith(headers: Record<string, string>, body: unknown) {
  return new NextRequest(URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/asaas", () => {
  const originalToken = process.env.ASAAS_WEBHOOK_TOKEN;

  beforeEach(async () => {
    await resetDb();
    process.env.ASAAS_WEBHOOK_TOKEN = TOKEN;
  });

  afterEach(() => {
    process.env.ASAAS_WEBHOOK_TOKEN = originalToken;
  });

  it("token correto processa o evento", async () => {
    const sub = await subscriptionFor("route-ok@example.com", "sub_route_ok");

    const response = await POST(
      requestWith(
        { "asaas-access-token": TOKEN },
        {
          id: "evt_route_1",
          event: "PAYMENT_CONFIRMED",
          payment: { subscription: "sub_route_ok", dueDate: "2026-10-01" },
        },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("applied");

    const updated = await testDb.subscription.findUnique({ where: { id: sub.id } });
    expect(updated?.status).toBe("ACTIVE");
  });

  it("token errado devolve 401 e não processa o evento", async () => {
    await subscriptionFor("route-wrong@example.com", "sub_route_wrong");

    const response = await POST(
      requestWith(
        { "asaas-access-token": "token-invasor" },
        {
          id: "evt_route_2",
          event: "PAYMENT_CONFIRMED",
          payment: { subscription: "sub_route_wrong", dueDate: "2026-10-01" },
        },
      ),
    );

    expect(response.status).toBe(401);

    const registered = await testDb.processedWebhookEvent.findUnique({
      where: { id: "evt_route_2" },
    });
    expect(registered).toBeNull();
  });

  it("header ausente devolve 401 e não processa o evento", async () => {
    await subscriptionFor("route-noheader@example.com", "sub_route_noheader");

    const response = await POST(
      requestWith(
        {},
        {
          id: "evt_route_3",
          event: "PAYMENT_CONFIRMED",
          payment: { subscription: "sub_route_noheader", dueDate: "2026-10-01" },
        },
      ),
    );

    expect(response.status).toBe(401);

    const registered = await testDb.processedWebhookEvent.findUnique({
      where: { id: "evt_route_3" },
    });
    expect(registered).toBeNull();
  });

  it("token ausente na configuração devolve 401 mesmo com header presente", async () => {
    delete process.env.ASAAS_WEBHOOK_TOKEN;

    const response = await POST(
      requestWith(
        { "asaas-access-token": "qualquer-coisa" },
        { id: "evt_route_4", event: "PAYMENT_CONFIRMED", payment: {} },
      ),
    );

    expect(response.status).toBe(401);

    const registered = await testDb.processedWebhookEvent.findUnique({
      where: { id: "evt_route_4" },
    });
    expect(registered).toBeNull();
  });
});
