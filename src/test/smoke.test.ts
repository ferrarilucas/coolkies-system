import { describe, expect, it } from "vitest";
import { testDb } from "./db";

describe("banco de teste", () => {
  it("conecta e responde", async () => {
    const result = await testDb.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    expect(result[0].ok).toBe(1);
  });
});
