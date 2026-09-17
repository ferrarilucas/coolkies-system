import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("next.config rewrites", () => {
  it("expõe os dois well-knowns de OAuth na raiz apontando para /api/auth", async () => {
    expect(typeof nextConfig.rewrites).toBe("function");

    const rewrites = await nextConfig.rewrites!();
    const list = Array.isArray(rewrites) ? rewrites : rewrites.beforeFiles;

    expect(list).toContainEqual({
      source: "/.well-known/oauth-authorization-server",
      destination: "/api/auth/.well-known/oauth-authorization-server",
    });
    expect(list).toContainEqual({
      source: "/.well-known/oauth-protected-resource",
      destination: "/api/auth/.well-known/oauth-protected-resource",
    });
  });
});
