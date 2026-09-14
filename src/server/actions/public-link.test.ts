import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

let sessionResult: unknown;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => sessionResult } },
}));

const { togglePublicLink } = await import("./public-link");

async function seedOwnerSession(workspaceId: string) {
  const user = await testDb.user.create({
    data: { id: `owner-${workspaceId}`, name: "Dona", email: `dona-${workspaceId}@example.com` },
  });
  await testDb.member.create({ data: { userId: user.id, workspaceId, role: "OWNER" } });
  const session = await testDb.session.create({
    data: {
      id: `s-${user.id}`,
      token: `tok-${user.id}`,
      userId: user.id,
      activeWorkspaceId: workspaceId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  sessionResult = { user: { id: user.id }, session: { id: session.id, activeWorkspaceId: workspaceId } };
}

describe("togglePublicLink", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("dono ativa e recebe um token", async () => {
    const workspace = await createWorkspace("Confeitaria");
    await seedOwnerSession(workspace.id);

    const res = await togglePublicLink(true);

    expect(res.ok).toBe(true);
    expect(res.data?.token).toHaveLength(22);
  });

  it("dono desativa e o token some", async () => {
    const workspace = await createWorkspace("Confeitaria 2");
    await seedOwnerSession(workspace.id);
    await togglePublicLink(true);

    const res = await togglePublicLink(false);

    expect(res).toEqual({ ok: true, data: { token: null } });
  });
});
