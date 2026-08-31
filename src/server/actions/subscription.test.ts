import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { subscribe } = await import("./subscription");

async function userWithWorkspace(id: string, email: string) {
  const user = await testDb.user.create({ data: { id, name: "Dona", email } });
  const ws = await testDb.workspace.create({
    data: { name: "WS", slug: `ws-${id}` },
  });
  await testDb.member.create({
    data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
  });
  sessionResult = {
    user: { id: user.id },
    session: { id: `s-${id}`, activeWorkspaceId: ws.id },
  };
  return { user, ws };
}

function stubAsaasFetch() {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("/customers")) {
      return new Response(JSON.stringify({ id: "cus_123" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        id: "sub_remote_1",
        status: "PENDING",
        nextDueDate: "2026-09-01",
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("subscribe", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("grava o asaasSubscriptionId na mesma operação da criação no gateway", async () => {
    const { user } = await userWithWorkspace("u-sub-sync", "sync@example.com");
    stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "123.456.789-09");

    const result = await subscribe(formData);
    expect(result.ok).toBe(true);

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.asaasSubscriptionId).toBe("sub_remote_1");
    expect(sub?.asaasCustomerId).toBe("cus_123");
    expect(sub?.status).toBe("TRIALING");
    expect(sub?.source).toBe("ASAAS");
  });

  it("não vira ACTIVE só por ter contratado", async () => {
    const { user } = await userWithWorkspace("u-sub-status", "status@example.com");
    stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cpfCnpj", "12345678909");

    await subscribe(formData);

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.status).not.toBe("ACTIVE");
  });

  it("plano anual manda o valor mensal multiplicado por doze para o asaas", async () => {
    await userWithWorkspace("u-sub-yearly", "yearly@example.com");
    const fetchMock = stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cycle", "YEARLY");
    formData.set("cpfCnpj", "12345678909");

    await subscribe(formData);

    const subscriptionCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/subscriptions"),
    );
    const body = JSON.parse(subscriptionCall?.[1]?.body as string);
    expect(body.value).toBe(238.8);
  });

  it("não permite contratar o plano unlimited pelo checkout", async () => {
    await userWithWorkspace("u-sub-unlimited", "unlimited@example.com");
    const formData = new FormData();
    formData.set("plan", "unlimited");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
  });

  it("recusa cpf/cnpj inválido", async () => {
    await userWithWorkspace("u-sub-doc", "doc@example.com");
    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cpfCnpj", "123");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
  });
});
