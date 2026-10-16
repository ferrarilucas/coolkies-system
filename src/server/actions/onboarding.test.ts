import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspace, resetDb, testDb } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Role = "OWNER" | "ADMIN" | "MEMBER";
const context: { workspaceId: string; userId: string; role: Role; canWrite: boolean } = {
  workspaceId: "",
  userId: "u-dona",
  role: "OWNER",
  canWrite: true,
};

vi.mock("@/server/tenant/context", () => ({
  getWorkspaceContext: async () => ({ ...context }),
  requireRole: async (...allowed: Role[]) => {
    if (!allowed.includes(context.role)) throw new Error("Não autorizado");
    return { ...context };
  },
}));

const {
  chooseWorkspaceSector,
  dismissOnboarding,
  finishAppTour,
  refreshOnboardingProgress,
  restartAppTour,
  resumeOnboarding,
} = await import("./onboarding");

describe("actions do onboarding", () => {
  beforeEach(async () => {
    await resetDb();
    context.workspaceId = (await createWorkspace("Loja")).id;
    context.role = "OWNER";
    context.canWrite = true;
    await testDb.user.create({ data: { id: "u-dona", name: "Dona", email: "dona@example.com" } });
  });

  it("grava o setor escolhido", async () => {
    expect(await chooseWorkspaceSector("roupas")).toEqual({ ok: true });
    const workspace = await testDb.workspace.findUnique({ where: { id: context.workspaceId } });
    expect(workspace?.sector).toBe("roupas");
  });

  it("recusa setor adulterado com mensagem", async () => {
    expect(await chooseWorkspaceSector("<script>")).toEqual({ ok: false, error: "Escolha o ramo do seu negócio." });
  });

  it("não deixa membro mexer no onboarding do workspace", async () => {
    context.role = "MEMBER";
    expect(await chooseWorkspaceSector("roupas")).toEqual({ ok: false, error: "Não autorizado" });
    expect(await dismissOnboarding()).toEqual({ ok: false, error: "Não autorizado" });
  });

  it("dispensa e retoma", async () => {
    await dismissOnboarding();
    expect((await testDb.workspace.findUnique({ where: { id: context.workspaceId } }))?.onboardingDismissedAt).not.toBeNull();
    await resumeOnboarding();
    expect((await testDb.workspace.findUnique({ where: { id: context.workspaceId } }))?.onboardingDismissedAt).toBeNull();
  });

  it("conclui e reinicia o tour do usuário", async () => {
    await finishAppTour();
    expect((await testDb.user.findUnique({ where: { id: "u-dona" } }))?.appTourCompletedAt).not.toBeNull();
    await restartAppTour();
    expect((await testDb.user.findUnique({ where: { id: "u-dona" } }))?.appTourCompletedAt).toBeNull();
  });

  it("devolve o progresso só para quem vê as missões", async () => {
    await chooseWorkspaceSector("roupas");
    await testDb.customer.create({ data: { name: "Ana", workspaceId: context.workspaceId } });
    expect((await refreshOnboardingProgress())?.cliente).toBe(true);

    context.role = "MEMBER";
    expect(await refreshOnboardingProgress()).toBeNull();
  });
});
