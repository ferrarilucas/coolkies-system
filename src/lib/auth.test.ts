import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "@/test/db";
import { auth } from "./auth";

describe("oidc-provider schema", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("grava e lê uma aplicação OAuth e seu token de acesso", async () => {
    const user = await testDb.user.create({ data: { id: "u1", name: "Ana", email: "ana@example.com" } });
    const application = await testDb.oauthApplication.create({
      data: {
        name: "Claude Desktop",
        clientId: "client-1",
        clientSecret: "secret-1",
        redirectUrls: "http://localhost/callback",
        type: "public",
        userId: user.id,
      },
    });
    await testDb.oauthAccessToken.create({
      data: {
        accessToken: "tok-1",
        refreshToken: "ref-1",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        refreshTokenExpiresAt: new Date(Date.now() + 604800_000),
        clientId: application.clientId,
        userId: user.id,
        scopes: "openid profile",
      },
    });

    const found = await testDb.oauthAccessToken.findUnique({ where: { accessToken: "tok-1" } });
    expect(found?.userId).toBe(user.id);
    expect(found?.clientId).toBe(application.clientId);
  });
});

describe("mcp plugin", () => {
  it("expõe o discovery document OAuth do MCP", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/.well-known/oauth-authorization-server"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_endpoint).toContain("/mcp/authorize");
    expect(body.token_endpoint).toContain("/mcp/token");
    expect(body.registration_endpoint).toContain("/mcp/register");
  });

  it("expõe o protected resource metadata", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/.well-known/oauth-protected-resource"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_servers).toContain("http://localhost:3000");
  });
});
