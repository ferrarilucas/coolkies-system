import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";

const {
  enablePublicLink,
  disablePublicLink,
  resolveWorkspaceByPublicToken,
  getPublicLinkState,
} = await import("./public-link");

describe("link público do workspace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("ativa, resolve pelo token e desativa", async () => {
    const workspace = await createWorkspace("Confeitaria");

    expect(await getPublicLinkState(workspace.id)).toEqual({ token: null });

    const token = await enablePublicLink(workspace.id);
    expect(token).toHaveLength(22);
    expect(await getPublicLinkState(workspace.id)).toEqual({ token });

    const resolved = await resolveWorkspaceByPublicToken(token);
    expect(resolved).toEqual({ id: workspace.id, name: "Confeitaria" });

    await disablePublicLink(workspace.id);
    expect(await getPublicLinkState(workspace.id)).toEqual({ token: null });
    expect(await resolveWorkspaceByPublicToken(token)).toBeNull();
  });

  it("token desconhecido não resolve nenhum workspace", async () => {
    expect(await resolveWorkspaceByPublicToken("token-que-nao-existe")).toBeNull();
  });
});
