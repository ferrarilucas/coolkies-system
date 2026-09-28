import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "./cron-auth";

describe("isAuthorizedCronRequest", () => {
  it("aceita o Bearer com o segredo certo", () => {
    expect(isAuthorizedCronRequest("Bearer s3gredo", "s3gredo")).toBe(true);
  });

  it("recusa segredo errado, sem cabeçalho ou com tamanho diferente", () => {
    expect(isAuthorizedCronRequest("Bearer outro", "s3gredo")).toBe(false);
    expect(isAuthorizedCronRequest(null, "s3gredo")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer s3gredo-e-mais", "s3gredo")).toBe(false);
  });

  it("sem CRON_SECRET no ambiente, recusa tudo", () => {
    expect(isAuthorizedCronRequest("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer ", "")).toBe(false);
  });
});
