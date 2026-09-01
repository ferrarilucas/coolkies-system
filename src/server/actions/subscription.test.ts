import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { subscribe, resumeCheckout } = await import("./subscription");

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

const OPEN_INVOICE_URL = "https://asaas.test/i/aberta";

function stubAsaasFetch() {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("/customers")) {
      return new Response(JSON.stringify({ id: "cus_123" }), { status: 200 });
    }
    if (url.includes("/payments")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "pay_1", status: "PENDING", dueDate: "2026-09-01", invoiceUrl: OPEN_INVOICE_URL },
          ],
        }),
        { status: 200 },
      );
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
    vi.stubEnv("ASAAS_ENV", "sandbox");
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
    expect(result.data?.invoiceUrl).toBe(OPEN_INVOICE_URL);

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.asaasSubscriptionId).toBe("sub_remote_1");
    expect(sub?.asaasCustomerId).toBe("cus_123");
    expect(sub?.status).toBe("TRIALING");
    expect(sub?.source).toBe("ASAAS");
  });

  it("deixa o pagador escolher a forma de pagamento no Asaas em vez de forçar Pix", async () => {
    await userWithWorkspace("u-sub-billing-type", "billingtype@example.com");
    const fetchMock = stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cpfCnpj", "12345678909");

    await subscribe(formData);

    const subscriptionCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/subscriptions"),
    );
    const body = JSON.parse(subscriptionCall?.[1]?.body as string);
    expect(body.billingType).toBe("UNDEFINED");
  });

  it("usuário em trial, sem asaasSubscriptionId, consegue contratar o mesmo plano do trial", async () => {
    const { user } = await userWithWorkspace("u-sub-trial-checkout", "trialcheckout@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "solo",
        cycle: "MONTHLY",
        source: "ASAAS",
        status: "TRIALING",
        trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    });
    const fetchMock = stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalled();

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.asaasSubscriptionId).toBe("sub_remote_1");
    expect(sub?.plan).toBe("solo");
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

  it("recusa plano que não existe em PLANS", async () => {
    await userWithWorkspace("u-sub-plan-invalido", "planinvalido@example.com");
    const fetchMock = stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "yolo");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Plano inválido.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa ciclo que não é MONTHLY nem YEARLY", async () => {
    await userWithWorkspace("u-sub-cycle-invalido", "cicloinvalido@example.com");
    const fetchMock = stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cycle", "WEEKLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Ciclo de cobrança inválido.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa reassinar o mesmo plano e ciclo sem chamar o Asaas de novo", async () => {
    const { user } = await userWithWorkspace("u-sub-dup", "dup@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "solo",
        cycle: "MONTHLY",
        source: "ASAAS",
        status: "TRIALING",
        asaasCustomerId: "cus_existing",
        asaasSubscriptionId: "sub_existing",
      },
    });
    const fetchMock = stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("já tem uma assinatura ativa");
    expect(fetchMock).not.toHaveBeenCalled();

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.asaasSubscriptionId).toBe("sub_existing");
  });

  it("exige confirmação explícita para trocar de plano com assinatura já ativa", async () => {
    const { user } = await userWithWorkspace("u-sub-switch-noconfirm", "switch1@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "solo",
        cycle: "MONTHLY",
        source: "ASAAS",
        status: "ACTIVE",
        asaasCustomerId: "cus_existing",
        asaasSubscriptionId: "sub_existing",
      },
    });
    const fetchMock = stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "team");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Confirme a troca");
    expect(fetchMock).not.toHaveBeenCalled();

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.asaasSubscriptionId).toBe("sub_existing");
    expect(sub?.plan).toBe("solo");
  });

  it("troca de plano prossegue quando a troca é confirmada, mas não cancela a antiga no gateway", async () => {
    const { user } = await userWithWorkspace("u-sub-switch-confirm", "switch2@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "solo",
        cycle: "MONTHLY",
        source: "ASAAS",
        status: "ACTIVE",
        asaasCustomerId: "cus_existing",
        asaasSubscriptionId: "sub_existing",
      },
    });
    stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "team");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");
    formData.set("confirmSwitch", "true");

    const result = await subscribe(formData);
    expect(result.ok).toBe(true);

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.asaasSubscriptionId).toBe("sub_remote_1");
    expect(sub?.plan).toBe("team");
  });

  it("erro de configuração do Asaas não vaza para o cliente e é logado no servidor", async () => {
    await userWithWorkspace("u-sub-infra", "infra@example.com");
    vi.stubEnv("ASAAS_API_KEY", "");
    vi.stubEnv("ASAAS_API_KEY_BASE64", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("ASAAS_API_KEY");
    expect(result.error).toBe(
      "Não foi possível concluir a contratação agora. Tente novamente em instantes.",
    );
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("mensagem de validação do Asaas chega ao usuário", async () => {
    await userWithWorkspace("u-sub-asaas-validation", "validation@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ description: "CPF inválido" }] }), {
          status: 400,
        }),
      ),
    );

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cpfCnpj", "12345678909");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CPF inválido");
  });
});

describe("resumeCheckout", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubEnv("ASAAS_ENV", "sandbox");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("recusa quando não existe assinatura pendente no gateway", async () => {
    await userWithWorkspace("u-resume-none", "resumenone@example.com");

    const result = await resumeCheckout();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Nenhuma assinatura pendente");
  });

  it("busca a cobrança em aberto da assinatura existente e devolve o link", async () => {
    const { user } = await userWithWorkspace("u-resume-ok", "resumeok@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "solo",
        cycle: "MONTHLY",
        source: "ASAAS",
        status: "TRIALING",
        asaasCustomerId: "cus_existing",
        asaasSubscriptionId: "sub_existing",
      },
    });
    stubAsaasFetch();

    const result = await resumeCheckout();
    expect(result.ok).toBe(true);
    expect(result.data?.invoiceUrl).toBe(OPEN_INVOICE_URL);
  });

  it("avisa quando não encontra cobrança em aberto mesmo depois da segunda tentativa", async () => {
    const { user } = await userWithWorkspace("u-resume-empty", "resumeempty@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "solo",
        cycle: "MONTHLY",
        source: "ASAAS",
        status: "TRIALING",
        asaasCustomerId: "cus_existing",
        asaasSubscriptionId: "sub_existing",
      },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ),
    );

    const promise = resumeCheckout();
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("contato@coolkies.com.br");
  });
});

describe("subscribe com assinatura atribuída manualmente", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubEnv("ASAAS_ENV", "sandbox");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("recusa a contratação, não chama o Asaas e preserva o plano negociado", async () => {
    const { user } = await userWithWorkspace("u-sub-manual", "manual@example.com");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "unlimited",
        cycle: "MONTHLY",
        source: "MANUAL",
        status: "ACTIVE",
      },
    });
    const fetchMock = stubAsaasFetch();

    const formData = new FormData();
    formData.set("plan", "solo");
    formData.set("cycle", "MONTHLY");
    formData.set("cpfCnpj", "12345678909");
    formData.set("confirmSwitch", "true");

    const result = await subscribe(formData);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("manualmente");
    expect(result.error).toContain("contato@coolkies.com.br");
    expect(fetchMock).not.toHaveBeenCalled();

    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });
    expect(sub?.plan).toBe("unlimited");
    expect(sub?.source).toBe("MANUAL");
    expect(sub?.asaasSubscriptionId).toBeNull();
  });
});
