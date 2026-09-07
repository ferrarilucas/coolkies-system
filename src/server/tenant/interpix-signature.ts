import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_MS = 5 * 60 * 1000;

export function isValidInterPixSignature(input: {
  raw: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: number;
}): boolean {
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return false;

  const age = (input.now ?? Date.now()) - timestamp;
  if (age > MAX_AGE_MS || age < 0) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.raw}`)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(input.signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
