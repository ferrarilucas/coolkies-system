import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type RateLimitRule = { limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export const API_RATE_LIMIT: RateLimitRule = { limit: 120, windowSeconds: 60 };

async function increment(key: string, windowStart: Date): Promise<number> {
  const row = await db.apiRateLimit.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  return row.count;
}

export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  let count: number;
  try {
    count = await increment(key, windowStart);
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    count = await increment(key, windowStart);
  }

  const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
  return { allowed: count <= rule.limit, retryAfterSeconds };
}

export async function pruneRateLimits(olderThan: Date): Promise<number> {
  const { count } = await db.apiRateLimit.deleteMany({ where: { windowStart: { lt: olderThan } } });
  return count;
}
