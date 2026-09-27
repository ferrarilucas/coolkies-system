import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import {
  assertWorkspaceFeature,
  FEATURE_UNAVAILABLE_MESSAGE,
  userHasFeature,
  workspaceHasFeature,
} from "./features";

const DAY = 24 * 60 * 60 * 1000;

async function ownerWith(id: string, sub: { plan: string; status: "ACTIVE" | "TRIALING"; trialEndsAt?: Date }) {
  const user = await testDb.user.create({ data: { id, name: "Dona", email: `${id}@example.com` } });
  await testDb.subscription.create({ data: { userId: user.id, ...sub } });
  const ws = await createWorkspace(`WS ${id}`);
  await testDb.member.create({ data: { userId: user.id, workspaceId: ws.id, role: "OWNER" } });
  return { user, ws };
}

describe("features", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("dono no cresce libera o recurso no workspace", async () => {
    const { user, ws } = await ownerWith("u-cresce", { plan: "cresce", status: "ACTIVE" });
    expect(await userHasFeature(user.id, "consolidatedDashboard")).toBe(true);
    expect(await workspaceHasFeature(ws.id, "publicLink")).toBe(true);
  });

  it("dono no corre não libera", async () => {
    const { ws } = await ownerWith("u-corre", { plan: "corre", status: "ACTIVE" });
    expect(await workspaceHasFeature(ws.id, "publicLink")).toBe(false);
  });

  it("trial em andamento libera, trial vencido não", async () => {
    const running = await ownerWith("u-trial", {
      plan: "corre",
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + 3 * DAY),
    });
    const expired = await ownerWith("u-trial-vencido", {
      plan: "corre",
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() - DAY),
    });
    expect(await workspaceHasFeature(running.ws.id, "autoShoppingList")).toBe(true);
    expect(await workspaceHasFeature(expired.ws.id, "autoShoppingList")).toBe(false);
  });

  it("membro comum herda o plano do dono", async () => {
    const { ws } = await ownerWith("u-dona", { plan: "cresce", status: "ACTIVE" });
    const member = await testDb.user.create({ data: { id: "u-membro", name: "M", email: "m@example.com" } });
    await testDb.member.create({ data: { userId: member.id, workspaceId: ws.id, role: "MEMBER" } });
    expect(await workspaceHasFeature(ws.id, "publicLink")).toBe(true);
    expect(await userHasFeature(member.id, "publicLink")).toBe(false);
  });

  it("workspace sem dono não libera", async () => {
    const ws = await createWorkspace("Órfão");
    expect(await workspaceHasFeature(ws.id, "publicLink")).toBe(false);
  });

  it("assertWorkspaceFeature lança a mensagem de upgrade", async () => {
    const { ws } = await ownerWith("u-corre-2", { plan: "corre", status: "ACTIVE" });
    await expect(assertWorkspaceFeature(ws.id, "publicLink")).rejects.toThrow(FEATURE_UNAVAILABLE_MESSAGE);
  });
});
