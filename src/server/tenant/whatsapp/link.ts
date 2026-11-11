import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const linkTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function hashLinkToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getWhatsAppLinkState(userId: string, token: string | null) {
  const [account, notice] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { whatsappPhone: true } }),
    token && linkTokenPattern.test(token)
      ? db.whatsAppNotice.findUnique({
          where: { tokenHash: hashLinkToken(token) },
          select: { phone: true, consumedAt: true, expiresAt: true },
        })
      : null,
  ]);
  return { linked: account?.whatsappPhone, notice };
}

export async function redeemWhatsAppLink(userId: string, token: string): Promise<boolean> {
  if (!linkTokenPattern.test(token)) return false;
  const now = new Date();

  try {
    return await db.$transaction(async (tx) => {
      const notice = await tx.whatsAppNotice.findUnique({
        where: { tokenHash: hashLinkToken(token) },
      });
      if (!notice || notice.consumedAt || notice.expiresAt <= now) return false;

      const claim = await tx.whatsAppNotice.updateMany({
        where: { phone: notice.phone, tokenHash: notice.tokenHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (!claim.count) return false;

      const account = await tx.user.updateMany({
        where: { id: userId, whatsappPhone: null },
        data: { whatsappPhone: notice.phone },
      });
      if (!account.count) throw new LinkUnavailableError();
      return true;
    });
  } catch (error) {
    if (error instanceof LinkUnavailableError) return false;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

class LinkUnavailableError extends Error {}
