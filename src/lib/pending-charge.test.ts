import { describe, expect, it } from "vitest";
import { isPendingChargeWarningActive } from "./pending-charge";

describe("isPendingChargeWarningActive", () => {
  it("está ativo antes do vencimento", () => {
    const dueAt = new Date("2026-09-18T00:00:00.000Z");
    expect(isPendingChargeWarningActive(dueAt, new Date("2026-09-17T23:00:00.000Z"))).toBe(true);
  });

  it("está ativo no próprio dia do vencimento", () => {
    const dueAt = new Date("2026-09-18T00:00:00.000Z");
    expect(isPendingChargeWarningActive(dueAt, new Date("2026-09-18T20:00:00.000Z"))).toBe(true);
  });

  it("expira no dia seguinte ao vencimento — a cobrança já deve ter sido debitada", () => {
    const dueAt = new Date("2026-09-18T00:00:00.000Z");
    expect(isPendingChargeWarningActive(dueAt, new Date("2026-09-19T00:00:00.000Z"))).toBe(false);
  });

  it("continua expirado bem depois do vencimento", () => {
    const dueAt = new Date("2026-09-18T00:00:00.000Z");
    expect(isPendingChargeWarningActive(dueAt, new Date("2026-12-01T00:00:00.000Z"))).toBe(false);
  });
});
