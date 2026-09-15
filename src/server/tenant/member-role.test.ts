import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb, createWorkspace } from "@/test/db";
import { updateMemberRole } from "./workspaces";

describe("updateMemberRole", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("promove um membro a admin", async () => {
    const workspace = await createWorkspace("Confeitaria");
    const owner = await testDb.user.create({
      data: { id: "u-owner", name: "Dona", email: "dona@example.com" },
    });
    await testDb.member.create({
      data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
    });
    const other = await testDb.user.create({
      data: { id: "u-membro", name: "Ajudante", email: "ajudante@example.com" },
    });
    const member = await testDb.member.create({
      data: { userId: other.id, workspaceId: workspace.id, role: "MEMBER" },
    });

    await updateMemberRole(workspace.id, member.id, "ADMIN", owner.id);

    const updated = await testDb.member.findUnique({ where: { id: member.id } });
    expect(updated?.role).toBe("ADMIN");
  });

  it("recusa definir alguém como proprietário", async () => {
    const workspace = await createWorkspace("Confeitaria 2");
    const owner = await testDb.user.create({
      data: { id: "u-owner2", name: "Dona", email: "dona2@example.com" },
    });
    await testDb.member.create({
      data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
    });
    const other = await testDb.user.create({
      data: { id: "u-membro2", name: "Ajudante", email: "ajudante2@example.com" },
    });
    const member = await testDb.member.create({
      data: { userId: other.id, workspaceId: workspace.id, role: "MEMBER" },
    });

    await expect(
      updateMemberRole(workspace.id, member.id, "OWNER", owner.id),
    ).rejects.toThrow("Não é possível definir alguém como proprietário por aqui.");

    const untouched = await testDb.member.findUnique({ where: { id: member.id } });
    expect(untouched?.role).toBe("MEMBER");
  });

  it("recusa alterar o papel do proprietário", async () => {
    const workspace = await createWorkspace("Confeitaria 3");
    const owner = await testDb.user.create({
      data: { id: "u-owner3", name: "Dona", email: "dona3@example.com" },
    });
    const ownerMember = await testDb.member.create({
      data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
    });
    const admin = await testDb.user.create({
      data: { id: "u-admin3", name: "Admin", email: "admin3@example.com" },
    });
    await testDb.member.create({
      data: { userId: admin.id, workspaceId: workspace.id, role: "ADMIN" },
    });

    await expect(
      updateMemberRole(workspace.id, ownerMember.id, "MEMBER", admin.id),
    ).rejects.toThrow("Não é possível alterar o papel do proprietário.");
  });

  it("recusa alterar o próprio papel", async () => {
    const workspace = await createWorkspace("Confeitaria 4");
    const owner = await testDb.user.create({
      data: { id: "u-owner4", name: "Dona", email: "dona4@example.com" },
    });
    await testDb.member.create({
      data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
    });
    const admin = await testDb.user.create({
      data: { id: "u-admin4", name: "Admin", email: "admin4@example.com" },
    });
    const adminMember = await testDb.member.create({
      data: { userId: admin.id, workspaceId: workspace.id, role: "ADMIN" },
    });

    await expect(
      updateMemberRole(workspace.id, adminMember.id, "MEMBER", admin.id),
    ).rejects.toThrow("Você não pode alterar seu próprio papel.");
  });

  it("recusa membro que não existe no workspace", async () => {
    const workspace = await createWorkspace("Confeitaria 5");
    const owner = await testDb.user.create({
      data: { id: "u-owner5", name: "Dona", email: "dona5@example.com" },
    });
    await testDb.member.create({
      data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
    });

    await expect(
      updateMemberRole(workspace.id, "member-inexistente", "ADMIN", owner.id),
    ).rejects.toThrow("Membro não encontrado.");
  });
});
