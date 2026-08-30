"use server";

import { revalidatePath } from "next/cache";
import type { MemberRole } from "@prisma/client";
import {
  cancelInvite as cancelInviteRecord,
  createInvite as createInviteRecord,
  createWorkspaceForUser,
  joinWithCode,
  setActiveWorkspace,
} from "@/server/tenant/workspaces";
import { formatInviteCode } from "@/server/tenant/workspaces";
import { getWorkspaceContext, requireRole } from "@/server/tenant/context";
import { sendInviteEmail } from "@/lib/email";
import { roleLabel } from "@/lib/roles";

export type ActionResult<T = undefined> = { ok: boolean; error?: string; data?: T };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Algo deu errado.";
}

export async function switchWorkspace(workspaceId: string): Promise<ActionResult> {
  try {
    await setActiveWorkspace(workspaceId);
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createWorkspace(formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "");
  try {
    await createWorkspaceForUser(name);
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function joinWorkspace(formData: FormData): Promise<ActionResult> {
  const code = String(formData.get("code") ?? "");
  try {
    const result = await joinWithCode(code);
    if (!result.ok) return { ok: false, error: result.error };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export type InviteCreated = { code: string; emailSent: boolean; emailError?: string };

export async function createInvite(
  formData: FormData,
): Promise<ActionResult<InviteCreated>> {
  const roleRaw = String(formData.get("role") ?? "MEMBER");
  const role = (roleRaw === "ADMIN" ? "ADMIN" : "MEMBER") as MemberRole;
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;

  try {
    const { workspaceId } = await requireRole("OWNER", "ADMIN");
    const invite = await createInviteRecord(workspaceId, role, email);

    let emailSent = false;
    let emailError: string | undefined;

    if (email) {
      const result = await sendInviteEmail({
        to: email,
        code: formatInviteCode(invite.code),
        workspaceName: invite.workspaceName,
        inviterName: invite.inviterName,
        roleLabel: roleLabel(role),
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      });
      emailSent = result.sent;
      emailError = result.reason;
    }

    revalidatePath("/workspaces/members");
    return { ok: true, data: { code: invite.code, emailSent, emailError } };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function cancelInvite(inviteId: string): Promise<ActionResult> {
  try {
    const { workspaceId } = await requireRole("OWNER", "ADMIN");
    await cancelInviteRecord(workspaceId, inviteId);
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  revalidatePath("/workspaces/members");
  return { ok: true };
}

export async function currentWorkspaceId(): Promise<string> {
  const { workspaceId } = await getWorkspaceContext();
  return workspaceId;
}
