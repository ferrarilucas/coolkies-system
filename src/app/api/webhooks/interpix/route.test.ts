import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";
import * as interpixEvents from "@/server/tenant/interpix-events";
import { POST } from "./route";

const SECRET = "segredo-do-webhook";

function entrega(body: unknown, opts: { secret?: string; timestamp?: string } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = opts.timestamp ?? String(Date.now());
  const signature = createHmac("sha256", opts.secret ?? SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex");

  return new NextRequest("http://localhost/api/webhooks/interpix", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-signature": signature,
      "x-timestamp": timestamp,
    },
  });
}

describe("POST /api/webhooks/interpix", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("INTERPIX_WEBHOOK_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("assinatura válida é processada", async () => {
    const user = await testDb.user.create({
      data: { id: "u-hook", name: "Dono", email: "hook@example.com" },
    });
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "corre",
        provider: "INTERPIX",
        status: "PENDING_AUTH",
        interpixSubscriptionId: "ipx-hook",
      },
    });

    const response = await POST(
      entrega({
        type: "cycle.paid",
        eventId: "50",
        data: { subscriptionId: "ipx-hook", cycleSeq: 1, amount: "34.50", paidAt: "2026-09-19T09:00:00.000Z" },
      }),
    );

    expect(response.status).toBe(200);
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).toBe("ACTIVE");
  });

  it("assinatura de outro segredo devolve 401 e não toca no banco", async () => {
    const response = await POST(
      entrega(
        { type: "cycle.paid", eventId: "51", data: { subscriptionId: "x", cycleSeq: 1, amount: "1.00", paidAt: "" } },
        { secret: "errado" },
      ),
    );

    expect(response.status).toBe(401);
    expect(await testDb.processedWebhookEvent.count()).toBe(0);
  });

  it("timestamp velho devolve 401", async () => {
    const velho = String(Date.now() - 10 * 60 * 1000);
    const response = await POST(
      entrega(
        { type: "cycle.paid", eventId: "52", data: { subscriptionId: "x", cycleSeq: 1, amount: "1.00", paidAt: "" } },
        { timestamp: velho },
      ),
    );

    expect(response.status).toBe(401);
  });

  it("segredo ausente na configuração devolve 401, sem processar", async () => {
    vi.stubEnv("INTERPIX_WEBHOOK_SECRET", "");
    const response = await POST(
      entrega({ type: "cycle.paid", eventId: "53", data: { subscriptionId: "x", cycleSeq: 1, amount: "1.00", paidAt: "" } }),
    );

    expect(response.status).toBe(401);
  });

  it("assinatura de subscription desconhecida devolve não-2xx para habilitar reentrega", async () => {
    const response = await POST(
      entrega({
        type: "cycle.paid",
        eventId: "54",
        data: { subscriptionId: "ipx-inexistente", cycleSeq: 1, amount: "1.00", paidAt: "" },
      }),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.outcome).toBe("unknown");
  });

  it("colisão de escrita concorrente devolve não-2xx para habilitar reentrega, sem descartar o evento", async () => {
    const spy = vi.spyOn(interpixEvents, "applyInterPixEvent").mockResolvedValueOnce("conflict");

    const response = await POST(
      entrega({
        type: "cycle.paid",
        eventId: "55",
        data: { subscriptionId: "ipx-conflito", cycleSeq: 1, amount: "1.00", paidAt: "" },
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.outcome).toBe("conflict");

    spy.mockRestore();
  });

  it("corpo que não é JSON válido devolve 200, registra no log e não toca no banco", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const timestamp = String(Date.now());
    const raw = "{isso não é json";
    const signature = createHmac("sha256", SECRET).update(`${timestamp}.${raw}`).digest("hex");

    const request = new NextRequest("http://localhost/api/webhooks/interpix", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        "x-signature": signature,
        "x-timestamp": timestamp,
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("invalid");
    expect(errorSpy).toHaveBeenCalled();
    expect(await testDb.processedWebhookEvent.count()).toBe(0);

    errorSpy.mockRestore();
  });

  it("payload sem os campos obrigatórios devolve 200, registra no log e não toca no banco", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      entrega({
        type: "cycle.paid",
        data: { cycleSeq: 1, amount: "1.00", paidAt: "" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("invalid");
    expect(errorSpy).toHaveBeenCalled();
    expect(await testDb.processedWebhookEvent.count()).toBe(0);

    errorSpy.mockRestore();
  });

  it("eventId fora do formato numérico devolve 200 e registra no log do servidor", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      entrega({
        type: "cycle.paid",
        eventId: "não-numerico",
        data: { subscriptionId: "x", cycleSeq: 1, amount: "1.00", paidAt: "" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("invalid");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
