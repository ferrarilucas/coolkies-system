import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const calls = vi.hoisted(() => ({ reconcile: 0, prune: 0, failed: 0 }));

vi.mock("@/server/tenant/reconcile", () => ({
  reconcileInterPixSubscriptions: async () => {
    calls.reconcile += 1;
    return { checked: 2, corrected: 1, diverged: 0, failed: calls.failed };
  },
}));

vi.mock("@/server/tenant/rate-limit", () => ({
  pruneRateLimits: async () => {
    calls.prune += 1;
    return 7;
  },
}));

const { GET } = await import("./route");

function request(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost:3000/api/cron/reconcile", { headers }) as unknown as NextRequest;
}

describe("GET /api/cron/reconcile", () => {
  beforeEach(() => {
    calls.reconcile = 0;
    calls.prune = 0;
    calls.failed = 0;
    process.env.CRON_SECRET = "s3gredo";
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("sem o segredo responde 401 e não roda nada", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(calls.reconcile).toBe(0);
  });

  it("com CRON_SECRET ausente no ambiente responde 401", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request("Bearer "));
    expect(res.status).toBe(401);
    expect(calls.reconcile).toBe(0);
  });

  it("com o segredo reconcilia, limpa o rate limit e devolve o resumo", async () => {
    const res = await GET(request("Bearer s3gredo"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 2, corrected: 1, diverged: 0, failed: 0, prunedRateLimits: 7 });
    expect(calls.prune).toBe(1);
  });

  it("responde 500 quando alguma assinatura falhou", async () => {
    calls.failed = 1;
    const res = await GET(request("Bearer s3gredo"));
    expect(res.status).toBe(500);
  });
});
