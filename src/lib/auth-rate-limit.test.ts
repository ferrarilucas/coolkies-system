import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/db";

process.env.AUTH_RATE_LIMIT = "on";
const { auth } = await import("./auth");

function signIn(ip: string) {
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email: "ninguem@example.com", password: "errada-123" }),
    }),
  );
}

describe("rate limit de login", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a sexta tentativa no mesmo minuto recebe 429", async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await signIn("203.0.113.7");
      expect(res.status).not.toBe(429);
    }
    const blocked = await signIn("203.0.113.7");
    expect(blocked.status).toBe(429);
  });

  it("outro IP não é afetado", async () => {
    for (let i = 0; i < 6; i += 1) await signIn("203.0.113.8");
    const other = await signIn("198.51.100.1");
    expect(other.status).not.toBe(429);
  });
});
