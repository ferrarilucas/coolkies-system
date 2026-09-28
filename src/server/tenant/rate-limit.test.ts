import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { consumeRateLimit, pruneAuthRateLimits, pruneRateLimits } from "./rate-limit";

const rule = { limit: 3, windowSeconds: 60 };
const t0 = new Date("2026-09-27T12:00:10Z");

describe("consumeRateLimit", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("libera até o limite e bloqueia o seguinte", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await consumeRateLimit("api:u1", rule, t0)).allowed).toBe(true);
    }
    const blocked = await consumeRateLimit("api:u1", rule, t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(50);
  });

  it("a janela seguinte começa do zero", async () => {
    for (let i = 0; i < 4; i += 1) await consumeRateLimit("api:u1", rule, t0);
    const next = await consumeRateLimit("api:u1", rule, new Date("2026-09-27T12:01:00Z"));
    expect(next.allowed).toBe(true);
  });

  it("chaves diferentes não se afetam", async () => {
    for (let i = 0; i < 4; i += 1) await consumeRateLimit("api:u1", rule, t0);
    expect((await consumeRateLimit("api:u2", rule, t0)).allowed).toBe(true);
  });

  it("chamadas simultâneas não perdem contagem", async () => {
    await Promise.all(Array.from({ length: 5 }, () => consumeRateLimit("api:u3", rule, t0)));
    const row = await testDb.apiRateLimit.findFirstOrThrow({ where: { key: "api:u3" } });
    expect(row.count).toBe(5);
  });

  it("pruneRateLimits apaga só as janelas antigas", async () => {
    await consumeRateLimit("api:u1", rule, new Date("2026-09-25T00:00:00Z"));
    await consumeRateLimit("api:u1", rule, t0);
    const removed = await pruneRateLimits(new Date("2026-09-26T00:00:00Z"));
    expect(removed).toBe(1);
    expect(await testDb.apiRateLimit.count()).toBe(1);
  });
});

describe("pruneAuthRateLimits", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("apaga só os contadores do better-auth sem requisição recente", async () => {
    await testDb.rateLimit.create({
      data: { id: "velho", key: "203.0.113.1/sign-in/email", count: 3, lastRequest: BigInt(Date.parse("2026-09-25T00:00:00Z")) },
    });
    await testDb.rateLimit.create({
      data: { id: "novo", key: "203.0.113.2/sign-in/email", count: 1, lastRequest: BigInt(t0.getTime()) },
    });

    const removed = await pruneAuthRateLimits(new Date("2026-09-26T00:00:00Z"));

    expect(removed).toBe(1);
    expect((await testDb.rateLimit.findMany()).map((r) => r.id)).toEqual(["novo"]);
  });
});
