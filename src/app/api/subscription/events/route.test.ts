import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { GET } = await import("./route");
const { publishSubscriptionChange } = await import("@/server/realtime/subscription-events");

async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
}

describe("GET /api/subscription/events", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sem sessão devolve 401", async () => {
    sessionResult = null;

    const response = await GET(new Request("http://localhost/api/subscription/events"));

    expect(response.status).toBe(401);
  });

  it("manda o estado atual ao conectar e um novo estado a cada mudança publicada", async () => {
    const user = await testDb.user.create({
      data: { id: "u-sse", name: "Dono", email: "sse@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "corre", provider: "INTERPIX", status: "PENDING_AUTH" },
    });
    sessionResult = { user: { id: user.id }, session: { id: "s-sse" } };
    const controller = new AbortController();

    const response = await GET(
      new Request("http://localhost/api/subscription/events", { signal: controller.signal }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const first = await nextChunk(reader);
    expect(first).toContain("event: state");
    expect(first).toContain('"authorized":false');

    await testDb.subscription.update({
      where: { userId: user.id },
      data: { authorizedAt: new Date() },
    });
    publishSubscriptionChange(user.id);

    const second = await nextChunk(reader);
    expect(second).toContain('"authorized":true');
    controller.abort();
    await reader.cancel();
  });
});
