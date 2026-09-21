import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /.well-known/oauth-authorization-server", () => {
  it("responde 200 com o discovery document, sem exigir sessão", async () => {
    const res = await GET(new Request("http://localhost:3000/.well-known/oauth-authorization-server"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_endpoint).toContain("/mcp/authorize");
    expect(body.token_endpoint).toContain("/mcp/token");
    expect(body.registration_endpoint).toContain("/mcp/register");
  });
});
