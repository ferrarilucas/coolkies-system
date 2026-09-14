import { db } from "@/lib/db";

const TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 22;
const MAX_TOKEN_ATTEMPTS = 5;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join("");
}

export type PublicWorkspaceRef = { id: string; name: string };

export async function enablePublicLink(workspaceId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const token = randomToken();
    const taken = await db.workspace.findUnique({ where: { publicToken: token } });
    if (taken) continue;

    await db.workspace.update({ where: { id: workspaceId }, data: { publicToken: token } });
    return token;
  }

  throw new Error("Não foi possível gerar o link. Tente de novo.");
}

export async function disablePublicLink(workspaceId: string): Promise<void> {
  await db.workspace.update({ where: { id: workspaceId }, data: { publicToken: null } });
}

export async function resolveWorkspaceByPublicToken(
  token: string,
): Promise<PublicWorkspaceRef | null> {
  return db.workspace.findUnique({
    where: { publicToken: token },
    select: { id: true, name: true },
  });
}

export async function getPublicLinkState(workspaceId: string): Promise<{ token: string | null }> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { publicToken: true },
  });
  return { token: workspace?.publicToken ?? null };
}
