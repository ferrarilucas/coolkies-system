import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "@/test/db";
import {
  activeWorkspaceIds,
  canWriteInWorkspace,
  ensureTrialSubscription,
  isSubscriptionUsable,
  resolveInvoiceUrl,
} from "./subscription";

function stubPaymentsResponse(...payloads: unknown[]) {
  const fetchMock = vi.fn();
  for (const payload of payloads) {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify(payload), { status: 200 }),
    );
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("resolveInvoiceUrl", () => {
  beforeEach(() => {
    vi.stubEnv("ASAAS_API_KEY", "chave-de-teste");
    vi.stubEnv("ASAAS_ENV", "sandbox");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("prefere a cobrança pendente em aberto e ignora a já paga", async () => {
    stubPaymentsResponse({
      data: [
        { id: "pay_old", status: "RECEIVED", dueDate: "2026-08-01", invoiceUrl: "https://asaas.test/i/old" },
        { id: "pay_open", status: "PENDING", dueDate: "2026-09-01", invoiceUrl: "https://asaas.test/i/open" },
      ],
    });

    const url = await resolveInvoiceUrl("sub_1");
    expect(url).toBe("https://asaas.test/i/open");
  });

  it("aceita cobrança OVERDUE como aberta", async () => {
    stubPaymentsResponse({
      data: [{ id: "pay_over", status: "OVERDUE", dueDate: "2026-08-01", invoiceUrl: "https://asaas.test/i/over" }],
    });

    const url = await resolveInvoiceUrl("sub_1");
    expect(url).toBe("https://asaas.test/i/over");
  });

  it("tenta de novo uma vez quando a primeira consulta não acha cobrança aberta", async () => {
    vi.useFakeTimers();
    const fetchMock = stubPaymentsResponse(
      { data: [] },
      { data: [{ id: "pay_new", status: "PENDING", dueDate: "2026-09-01", invoiceUrl: "https://asaas.test/i/new" }] },
    );

    const promise = resolveInvoiceUrl("sub_1");
    await vi.advanceTimersByTimeAsync(1500);
    const url = await promise;

    expect(url).toBe("https://asaas.test/i/new");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("desiste depois da segunda tentativa e retorna null", async () => {
    vi.useFakeTimers();
    const fetchMock = stubPaymentsResponse({ data: [] }, { data: [] });

    const promise = resolveInvoiceUrl("sub_1");
    await vi.advanceTimersByTimeAsync(1500);
    const url = await promise;

    expect(url).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("model de assinatura", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria assinatura ligada ao usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-sub", name: "Ana", email: "ana@example.com" },
    });

    const sub = await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL" },
    });

    expect(sub.status).toBe("TRIALING");
    expect(sub.asaasSubscriptionId).toBeNull();
  });

  it("permite no máximo uma assinatura por usuário", async () => {
    const user = await testDb.user.create({
      data: { id: "u-dup", name: "Bia", email: "bia@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL" },
    });

    await expect(
      testDb.subscription.create({
        data: { userId: user.id, plan: "team", source: "MANUAL" },
      }),
    ).rejects.toThrow();
  });
});

describe("workspaces ativos por plano", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function ownerWith(plan: string, count: number) {
    const user = await testDb.user.create({
      data: { id: `u-${plan}-${count}`, name: "Dono", email: `${plan}${count}@example.com` },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan, source: "MANUAL", status: "ACTIVE" },
    });

    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const ws = await testDb.workspace.create({
        data: { name: `WS ${i}`, slug: `${plan}-${count}-${i}` },
      });
      await testDb.member.create({
        data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
      });
      ids.push(ws.id);
    }
    return { user, ids };
  }

  it("plano solo com tres workspaces ativa so o mais antigo", async () => {
    const { user, ids } = await ownerWith("solo", 3);
    const active = await activeWorkspaceIds(user.id);

    expect(active.has(ids[0])).toBe(true);
    expect(active.has(ids[1])).toBe(false);
    expect(active.has(ids[2])).toBe(false);
  });

  it("plano team ativa os quatro primeiros", async () => {
    const { user, ids } = await ownerWith("team", 5);
    const active = await activeWorkspaceIds(user.id);

    expect(active.size).toBe(4);
    expect(active.has(ids[4])).toBe(false);
  });

  it("plano unlimited ativa todos", async () => {
    const { user, ids } = await ownerWith("unlimited", 7);
    const active = await activeWorkspaceIds(user.id);

    expect(active.size).toBe(ids.length);
  });

  it("empate de createdAt resolve sempre no mesmo workspace", async () => {
    const user = await testDb.user.create({
      data: { id: "u-empate", name: "Dona", email: "empate@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL", status: "ACTIVE" },
    });

    const mesmoInstante = new Date("2026-08-01T12:00:00Z");
    const ids = ["ws-empate-c", "ws-empate-a", "ws-empate-b"];
    for (const id of ids) {
      await testDb.workspace.create({
        data: { id, name: id, slug: id },
      });
      await testDb.member.create({
        data: {
          userId: user.id,
          workspaceId: id,
          role: "OWNER",
          createdAt: mesmoInstante,
        },
      });
    }

    const menorId = [...ids].sort()[0];

    for (let i = 0; i < 5; i += 1) {
      const active = await activeWorkspaceIds(user.id);
      expect(active.size).toBe(1);
      expect(active.has(menorId)).toBe(true);
    }
  });

  it("ser member nao consome cota do proprio plano", async () => {
    const user = await testDb.user.create({
      data: { id: "u-member-nao-consome", name: "Dono", email: "membernaoconsome@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL", status: "ACTIVE" },
    });

    const alheio = await testDb.workspace.create({
      data: { name: "Alheio", slug: "alheio-cota" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: alheio.id, role: "MEMBER" },
    });

    const proprio = await testDb.workspace.create({
      data: { name: "Proprio", slug: "proprio-cota" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: proprio.id, role: "OWNER" },
    });

    const active = await activeWorkspaceIds(user.id);
    expect(active.has(proprio.id)).toBe(true);
    expect(active.has(alheio.id)).toBe(false);
  });
});

describe("assinatura utilizavel", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("ACTIVE vale", () => {
    expect(isSubscriptionUsable({ status: "ACTIVE" } as never, now)).toBe(true);
  });

  it("TRIALING dentro do prazo vale", () => {
    const sub = { status: "TRIALING", trialEndsAt: new Date("2026-09-10") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("TRIALING vencido nao vale", () => {
    const sub = { status: "TRIALING", trialEndsAt: new Date("2026-08-20") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("PAST_DUE dentro da tolerancia vale", () => {
    const sub = { status: "PAST_DUE", graceUntil: new Date("2026-09-05") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(true);
  });

  it("PAST_DUE com tolerancia vencida nao vale", () => {
    const sub = { status: "PAST_DUE", graceUntil: new Date("2026-08-25") } as never;
    expect(isSubscriptionUsable(sub, now)).toBe(false);
  });

  it("sem assinatura nao vale", () => {
    expect(isSubscriptionUsable(null, now)).toBe(false);
  });
});

describe("permissao de escrita", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("workspace excedente fica somente leitura", async () => {
    const user = await testDb.user.create({
      data: { id: "u-write", name: "Dono", email: "write@example.com" },
    });
    await testDb.subscription.create({
      data: { userId: user.id, plan: "solo", source: "MANUAL", status: "ACTIVE" },
    });

    const primeiro = await testDb.workspace.create({
      data: { name: "Primeiro", slug: "primeiro-write" },
    });
    const segundo = await testDb.workspace.create({
      data: { name: "Segundo", slug: "segundo-write" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: primeiro.id, role: "OWNER" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: segundo.id, role: "OWNER" },
    });

    expect(await canWriteInWorkspace(primeiro.id)).toBe(true);
    expect(await canWriteInWorkspace(segundo.id)).toBe(false);
  });

  it("workspace sem owner com assinatura utilizavel fica somente leitura", async () => {
    const user = await testDb.user.create({
      data: { id: "u-nosub", name: "Sem plano", email: "nosub@example.com" },
    });
    const ws = await testDb.workspace.create({
      data: { name: "Sem plano", slug: "sem-plano" },
    });
    await testDb.member.create({
      data: { userId: user.id, workspaceId: ws.id, role: "OWNER" },
    });

    expect(await canWriteInWorkspace(ws.id)).toBe(false);
  });
});

describe("trial na criacao do primeiro workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("cria assinatura em trial de 14 dias", async () => {
    const user = await testDb.user.create({
      data: { id: "u-trial", name: "Nova", email: "trial@example.com" },
    });

    await ensureTrialSubscription(user.id);
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });

    expect(sub?.status).toBe("TRIALING");
    expect(sub?.plan).toBe("solo");
    const dias = Math.round(
      ((sub?.trialEndsAt?.getTime() ?? 0) - Date.now()) / 86400000,
    );
    expect(dias).toBe(14);
  });

  it("nao renova o trial de quem ja tem assinatura", async () => {
    const user = await testDb.user.create({
      data: { id: "u-retrial", name: "Velha", email: "retrial@example.com" },
    });
    const antiga = new Date("2026-01-01");
    await testDb.subscription.create({
      data: {
        userId: user.id,
        plan: "solo",
        source: "MANUAL",
        trialEndsAt: antiga,
      },
    });

    await ensureTrialSubscription(user.id);
    const sub = await testDb.subscription.findUnique({ where: { userId: user.id } });

    expect(sub?.trialEndsAt?.toISOString()).toBe(antiga.toISOString());
  });
});
