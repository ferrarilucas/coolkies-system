import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function req(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, "http://localhost:3000"));
}

describe("middleware", () => {
  it("deixa passar /.well-known/* sem sessão, sem redirecionar", () => {
    const res = middleware(req("/.well-known/oauth-authorization-server"));
    expect(res.status).not.toBe(307);
  });

  it("continua redirecionando rotas protegidas sem sessão", () => {
    const res = middleware(req("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/sign-in");
  });

  it("deixa /sign-in passar direto", () => {
    const res = middleware(req("/sign-in"));
    expect(res.status).not.toBe(307);
  });
});
