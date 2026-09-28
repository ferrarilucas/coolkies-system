import { db } from "@/lib/db";
import { TERMS_VERSION } from "@/lib/legal";

export async function hasAcceptedCurrentTerms(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { termsVersion: true } });
  return user?.termsVersion === TERMS_VERSION;
}

export async function acceptCurrentTerms(userId: string, now: Date = new Date()): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { termsVersion: TERMS_VERSION, termsAcceptedAt: now },
  });
}
