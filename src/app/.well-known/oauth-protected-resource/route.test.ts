import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /.well-known/oauth-protected-resource", () => {
  it("responde 200 com o resource metadata, sem exigir sessão", async () => {
    const res = await GET(new Request("http://localhost:3000/.well-known/oauth-protected-resource"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_servers).toContain("http://localhost:3000");
  });
});
