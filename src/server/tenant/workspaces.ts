import { headers } from "next/headers";
import type { MemberRole } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveLimit } from "@/lib/plans";
import { normalizeName } from "@/lib/text";
import { ensureTrialSubscription, getSubscription } from "./subscription";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_GROUP = 4;
const INVITE_DAYS = 7;
const MAX_CODE_ATTEMPTS = 5;

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
};

export type MemberSummary = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: MemberRole;
  isSelf: boolean;
};

export type InviteSummary = {
  id: string;
  code: string;
  role: MemberRole;
  email: string | null;
  expiresAt: Date;
};

export function formatInviteCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += CODE_GROUP) {
    groups.push(code.slice(i, i + CODE_GROUP));
  }
  return groups.join("-");
}

export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "workspace";
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const taken = await db.workspace.findUnique({ where: { slug: candidate } });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Não autenticado");
  return session.user.id;
}

export async function listUserWorkspaces(): Promise<WorkspaceSummary[]> {
  const userId = await requireUserId();
  const members = await db.member.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  return members.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    role: m.role,
  }));
}

export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Não autenticado");

  const membership = await db.member.findFirst({
    where: { userId: session.user.id, workspaceId },
  });
  if (!membership) throw new Error("Você não participa deste workspace.");

  await db.session.update({
    where: { id: session.session.id },
    data: { activeWorkspaceId: workspaceId },
  });
}

export async function createWorkspaceForUser(name: string): Promise<string> {
  const userId = await requireUserId();
  const clean = normalizeName(name);
  if (!clean) throw new Error("Informe um nome para o workspace.");

  await ensureTrialSubscription(userId);

  const sub = await getSubscription(userId);
  const owned = await db.member.count({ where: { userId, role: "OWNER" } });
  const limit = effectiveLimit(sub?.plan ?? "solo", sub?.status ?? "TRIALING");
  if (owned + 1 > limit) {
    throw new Error(
      sub?.status === "TRIALING"
        ? "Durante o teste você pode ter um workspace. Assine um plano para criar outro."
        : "Seu plano não permite mais workspaces. Faça upgrade para criar outro.",
    );
  }

  const slug = await uniqueSlug(clean);

  const workspace = await db.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: { name: clean, slug },
    });
    await tx.member.create({
      data: { userId, workspaceId: created.id, role: "OWNER" },
    });
    return created;
  });

  await setActiveWorkspace(workspace.id);
  return workspace.id;
}

export async function listMembers(workspaceId: string): Promise<MemberSummary[]> {
  const userId = await requireUserId();
  const members = await db.member.findMany({
    where: { workspaceId },
    include: { user: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return members.map((m) => ({
    id: m.id,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role,
    isSelf: m.userId === userId,
  }));
}

export async function listPendingInvites(workspaceId: string): Promise<InviteSummary[]> {
  const invites = await db.invitation.findMany({
    where: { workspaceId, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  return invites.map((i) => ({
    id: i.id,
    code: i.code,
    role: i.role,
    email: i.email,
    expiresAt: i.expiresAt,
  }));
}

export type CreatedInvite = {
  code: string;
  workspaceName: string;
  inviterName: string;
};

export async function createInvite(
  workspaceId: string,
  role: MemberRole,
  email: string | null,
): Promise<CreatedInvite> {
  const inviterId = await requireUserId();

  const [workspace, inviter] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId } }),
    db.user.findUnique({ where: { id: inviterId } }),
  ]);
  if (!workspace) throw new Error("Workspace não encontrado.");

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomCode();
    const taken = await db.invitation.findUnique({ where: { code } });
    if (taken) continue;

    await db.invitation.create({
      data: {
        code,
        workspaceId,
        role,
        email,
        inviterId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    return {
      code,
      workspaceName: workspace.name,
      inviterName: inviter?.name ?? "Alguém",
    };
  }

  throw new Error("Não foi possível gerar um código. Tente de novo.");
}

export async function cancelInvite(workspaceId: string, inviteId: string): Promise<void> {
  await db.invitation.updateMany({
    where: { id: inviteId, workspaceId, status: "PENDING" },
    data: { status: "CANCELED" },
  });
}

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const attemptsByUser = new Map<string, { count: number; resetAt: number }>();

function consumeAttempt(userId: string): boolean {
  const now = Date.now();
  const entry = attemptsByUser.get(userId);

  if (!entry || entry.resetAt < now) {
    attemptsByUser.set(userId, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_CODE_ATTEMPTS) return false;

  entry.count += 1;
  return true;
}

export type JoinResult =
  | { ok: true; workspaceName: string }
  | { ok: false; error: string };

export async function joinWithCode(rawCode: string): Promise<JoinResult> {
  const userId = await requireUserId();
  const code = normalizeInviteCode(rawCode);

  if (code.length !== CODE_LENGTH) {
    return { ok: false, error: "Código inválido." };
  }

  if (!consumeAttempt(userId)) {
    return { ok: false, error: "Muitas tentativas. Espere alguns minutos." };
  }

  const invite = await db.invitation.findUnique({
    where: { code },
    include: { workspace: true },
  });

  if (!invite || invite.status !== "PENDING" || invite.expiresAt < new Date()) {
    return { ok: false, error: "Código inválido ou expirado." };
  }

  const existing = await db.member.findFirst({
    where: { userId, workspaceId: invite.workspaceId },
  });

  if (existing) {
    await setActiveWorkspace(invite.workspaceId);
    return { ok: true, workspaceName: invite.workspace.name };
  }

  await db.$transaction(async (tx) => {
    await tx.member.create({
      data: { userId, workspaceId: invite.workspaceId, role: invite.role },
    });
    await tx.invitation.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED" },
    });
  });

  await setActiveWorkspace(invite.workspaceId);
  return { ok: true, workspaceName: invite.workspace.name };
}

export const INVITE_CODE_LENGTH = CODE_LENGTH;
export const INVITE_MAX_ATTEMPTS = MAX_CODE_ATTEMPTS;
